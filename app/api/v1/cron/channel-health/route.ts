/**
 * GET /api/v1/cron/channel-health
 *
 * Watchdog do canal WhatsApp — detecta as falhas SILENCIOSAS que o health
 * check não vê (o /api/v1/health só testa se o WAHA responde HTTP):
 *
 *  1. Engine errado: sessão rodando fora do NOWEB (ex.: WEBJS por env legada
 *     WHATSAPP_DEFAULT_ENGINE) → mensagens podem ser dropadas sem erro visível
 *     ("parseMessageIdSerialized ... undefined"). Incidente CRITICAL.
 *  2. Sessão divergente: channel_sessions diz WORKING mas o WAHA reporta outro
 *     estado (ou a sessão sumiu do WAHA, ex.: troca de engine/volume). Corrige
 *     o status no banco (acende o ConnectionHealthDot na sidebar) e abre
 *     incidente WARNING.
 *
 * Incidentes são deduplicados por `type` enquanto houver um aberto.
 * Auth: Bearer INTERNAL_CRON_SECRET (fallback INTERNAL_SECRET), fail-closed —
 * mesmo padrão de storage-redaction.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWahaClient } from "@/lib/waha/client";

export const dynamic = "force-dynamic";

const EXPECTED_ENGINE = "NOWEB";

interface CheckStats {
  waha_reachable: boolean;
  sessions_in_waha: number;
  engine_mismatches: number;
  sessions_diverged: number;
  incidents_created: number;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const stats: CheckStats = {
    waha_reachable: false,
    sessions_in_waha: 0,
    engine_mismatches: 0,
    sessions_diverged: 0,
    incidents_created: 0,
  };

  const waha = getWahaClient();
  const admin = createAdminClient();

  let wahaSessions: Array<{ name: string; status: string; engine?: { engine?: string } }> = [];
  if (waha) {
    try {
      wahaSessions = await waha.listSessions();
      stats.waha_reachable = true;
      stats.sessions_in_waha = wahaSessions.length;
    } catch {
      // WAHA fora do ar já aparece no /health e derruba o dot — não duplicar.
      return ok(stats, { requestId });
    }
  } else {
    return ok(stats, { requestId });
  }

  // ── 1. Engine mismatch (global, não por tenant) ────────────────────────────
  const badEngine = wahaSessions.filter(
    (s) => s.engine?.engine && s.engine.engine.toUpperCase() !== EXPECTED_ENGINE,
  );
  stats.engine_mismatches = badEngine.length;
  if (badEngine.length > 0) {
    stats.incidents_created += await openIncidentOnce(admin, {
      type: "waha_engine_mismatch",
      severity: "critical",
      payload: {
        expected: EXPECTED_ENGINE,
        sessions: badEngine.map((s) => ({ name: s.name, engine: s.engine?.engine })),
        hint: "Engine fora do NOWEB dropa mensagens silenciosamente. Confira WAHA_DEFAULT_ENGINE/WHATSAPP_DEFAULT_ENGINE no compose e recrie o container waha.",
      },
    });
  }

  // ── 2. Sessões que o banco acha WORKING mas o WAHA discorda ───────────────
  const { data: dbSessions } = await admin
    .from("channel_sessions")
    .select("id, organization_id, waha_session_name, status")
    .eq("status", "WORKING");

  const byName = new Map(wahaSessions.map((s) => [s.name, s]));
  for (const row of (dbSessions ?? []) as Array<{
    id: string;
    organization_id: string;
    waha_session_name: string;
    status: string;
  }>) {
    const actual = byName.get(row.waha_session_name);
    const actualStatus = actual?.status ?? "STOPPED";
    if (actualStatus === "WORKING") continue;

    stats.sessions_diverged += 1;
    // Corrige o status → sidebar/Conexões passam a refletir a realidade.
    await admin
      .from("channel_sessions")
      .update({ status: actualStatus, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("organization_id", row.organization_id);

    stats.incidents_created += await openIncidentOnce(admin, {
      type: "channel_session_down",
      severity: "warning",
      organizationId: row.organization_id,
      payload: {
        waha_session_name: row.waha_session_name,
        db_status: row.status,
        waha_status: actualStatus,
        hint: "Sessão do WhatsApp não está WORKING no WAHA. Reconecte em /app/connections (QR code).",
      },
    });
  }

  return ok(stats, { requestId });
}

/** Cria incidente apenas se não houver outro aberto do mesmo type. Retorna 0|1. */
async function openIncidentOnce(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    type: string;
    severity: "info" | "warning" | "critical";
    payload: Record<string, unknown>;
    organizationId?: string;
  },
): Promise<number> {
  const { data: existing } = await admin
    .from("incidents")
    .select("id")
    .eq("type", input.type)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (existing) return 0;

  const { error } = await admin.from("incidents").insert({
    organization_id: input.organizationId ?? null,
    type: input.type,
    severity: input.severity,
    status: "open",
    payload: input.payload,
  });
  if (error) {
    console.error("[channel-health] incident insert failed", error.message);
    return 0;
  }
  return 1;
}
