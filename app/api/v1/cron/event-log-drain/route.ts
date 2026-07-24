/**
 * GET /api/v1/cron/event-log-drain
 *
 * Driver do event_log para os handlers assíncronos de RAG e LGPD. Sem ele,
 * `knowledge_source.updated` (indexação da base de conhecimento) e os eventos
 * de LGPD ficariam parados para sempre.
 *
 * CUIDADO deliberado: registra SÓ rag-indexer + lgpd, NÃO o pipeline de IA
 * legado (ai-response/sentiment) — o mcp_agent atual é servido pelo
 * agent-dispatcher. E filtra o SELECT pelos event_types desses handlers, para
 * nunca tocar em `message.*` (que o agent-dispatcher possui) → zero risco de
 * resposta duplicada.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET (fallback INTERNAL_SECRET), fail-closed.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import {
  dispatchEvent,
  getRegisteredHandlers,
  registerHandler,
  type EventRow,
} from "@/lib/event-log/dispatcher";
import { ragIndexerHandler } from "@/workers/rag-indexer.handler";
import { lgpdExportHandler } from "@/workers/lgpd-export-worker.handler";
import { lgpdRedactHandler } from "@/workers/lgpd-redact-worker.handler";
import { mysteryResponderHandler, mysteryReportHandler } from "@/workers/mystery-shopper.handler";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BATCH = 25;
const MAX_ATTEMPTS = 5;

function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000, 30_000 * 2 ** attempts);
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  // Registra apenas os handlers seguros p/ este drain (idempotente).
  registerHandler(ragIndexerHandler);
  registerHandler(lgpdExportHandler);
  registerHandler(lgpdRedactHandler);
  registerHandler(mysteryResponderHandler);
  registerHandler(mysteryReportHandler);
  const types = [...new Set(getRegisteredHandlers().flatMap((h) => h.events))];

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await admin
    .from("event_log")
    .select("id, organization_id, event_type, entity_kind, entity_id, payload, metadata, consumed_by, attempts")
    .eq("status", "pending")
    .in("event_type", types)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  let processed = 0;
  let retried = 0;
  let dead = 0;
  for (const raw of (rows ?? []) as EventRow[]) {
    const results = await dispatchEvent(raw);
    const okKeys = results.filter((r) => r.status === "ok" || r.status === "skipped").map((r) => r.consumer_key);
    const errored = results.filter((r) => r.status === "error");
    const consumed = [...new Set([...(raw.consumed_by ?? []), ...okKeys])];

    if (errored.length > 0) {
      const attempts = (raw.attempts ?? 0) + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await admin
          .from("event_log")
          .update({ status: "dead", attempts, consumed_by: consumed, last_error: errored[0]?.detail ?? "error", updated_at: new Date().toISOString() })
          .eq("id", raw.id);
        dead += 1;
      } else {
        await admin
          .from("event_log")
          .update({
            attempts,
            consumed_by: consumed,
            last_error: errored[0]?.detail ?? "error",
            next_attempt_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", raw.id);
        retried += 1;
      }
    } else {
      await admin
        .from("event_log")
        .update({ status: "processed", consumed_by: consumed, last_error: null, updated_at: new Date().toISOString() })
        .eq("id", raw.id);
      processed += 1;
    }
  }

  return ok({ scanned: rows?.length ?? 0, processed, retried, dead, types }, { requestId });
}
