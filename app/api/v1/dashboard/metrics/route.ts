/**
 * GET /api/v1/dashboard/metrics?days=30 — métricas do painel inicial.
 * Tudo derivado das tabelas existentes (leads, ai_agent_runs, messages,
 * conversations). Server-side (RLS por sessão + filtro explícito de org).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const MSG_CAP = 20000;
const TZ = "America/Sao_Paulo";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  const orgId = activeOrg.orgId;

  const daysParam = Number.parseInt(new URL(req.url).searchParams.get("days") ?? "30", 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 180 ? daysParam : 30;
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  const admin = createAdminClient();

  // ── Funil (pipeline "leads", fallback: primeiro pipeline por posição) ──────
  const leadsPipe = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("slug", "leads")
    .maybeSingle();
  let pipelineId = (leadsPipe.data?.id as string | undefined) ?? null;
  if (!pipelineId) {
    const { data: firstPipe } = await admin
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", orgId)
      .eq("is_archived", false)
      .order("position")
      .limit(1)
      .maybeSingle();
    pipelineId = (firstPipe?.id as string | undefined) ?? null;
  }

  let funnel: Array<{ stage: string; count: number; value_cents: number; is_won: boolean; is_lost: boolean }> = [];
  let leadsTotal = 0;
  let wonCount = 0;
  const scoreBuckets = { quente: 0, morno: 0, frio: 0 };
  if (pipelineId) {
    const [{ data: stages }, { data: leads }] = await Promise.all([
      admin
        .from("crm_stages")
        .select("id, name, position, is_won, is_lost")
        .eq("organization_id", orgId)
        .eq("pipeline_id", pipelineId)
        .eq("is_archived", false)
        .order("position"),
      admin
        .from("crm_leads")
        .select("stage_id, status, value_cents, custom_fields")
        .eq("organization_id", orgId)
        .eq("pipeline_id", pipelineId)
        .neq("status", "archived"),
    ]);
    const byStage = new Map<string, { count: number; value: number }>();
    for (const l of (leads ?? []) as Array<{ stage_id: string; status: string; value_cents: number | null; custom_fields: Record<string, unknown> | null }>) {
      leadsTotal += 1;
      if (l.status === "won") wonCount += 1;
      const agg = byStage.get(l.stage_id) ?? { count: 0, value: 0 };
      agg.count += 1;
      agg.value += l.value_cents ?? 0;
      byStage.set(l.stage_id, agg);
      const score = Number(l.custom_fields?.["score"]);
      if (Number.isFinite(score)) {
        if (score >= 70) scoreBuckets.quente += 1;
        else if (score >= 40) scoreBuckets.morno += 1;
        else scoreBuckets.frio += 1;
      }
    }
    funnel = ((stages ?? []) as Array<{ id: string; name: string; is_won: boolean; is_lost: boolean }>).map((s) => ({
      stage: s.name,
      count: byStage.get(s.id)?.count ?? 0,
      value_cents: byStage.get(s.id)?.value ?? 0,
      is_won: s.is_won,
      is_lost: s.is_lost,
    }));
  }

  // ── IA vs humano (ai_agent_runs no período) ────────────────────────────────
  const { data: runs } = await admin
    .from("ai_agent_runs")
    .select("status, is_followup")
    .eq("organization_id", orgId)
    .eq("is_dry_run", false)
    .gte("started_at", sinceIso)
    .limit(MSG_CAP);
  let aiReplies = 0;
  let handoffs = 0;
  let followupRuns = 0;
  for (const r of (runs ?? []) as Array<{ status: string; is_followup: boolean | null }>) {
    if (r.status === "completed") aiReplies += 1;
    if (r.status === "handoff") handoffs += 1;
    if (r.is_followup) followupRuns += 1;
  }

  // ── Conversas & mensagens do período (hora local + volume) ─────────────────
  const { data: msgs } = await admin
    .from("messages")
    .select("created_at, direction, metadata")
    .eq("organization_id", orgId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(MSG_CAP);
  const rows = (msgs ?? []) as Array<{ created_at: string; direction: string; metadata: Record<string, unknown> | null }>;
  const capped = rows.length >= MSG_CAP;

  const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false });
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, inbound: 0, outbound: 0 }));
  let inboundTotal = 0;
  let followupsSent = 0;
  for (const m of rows) {
    const h = Number(hourFmt.format(new Date(m.created_at))) % 24;
    const bucket = hourly[h];
    if (!bucket) continue;
    if (m.direction === "inbound") {
      bucket.inbound += 1;
      inboundTotal += 1;
    } else {
      bucket.outbound += 1;
      if (m.metadata?.["followup_step"] != null) followupsSent += 1;
    }
  }

  // Janela comercial: usa followup_settings.send_window; fallback 08–18.
  const { data: fu } = await admin
    .from("followup_settings")
    .select("send_window")
    .eq("organization_id", orgId)
    .maybeSingle();
  const win = (fu?.send_window as { start?: string; end?: string } | null) ?? null;
  const startHour = win?.start ? Number(win.start.split(":")[0]) : 8;
  const endHour = win?.end ? Number(win.end.split(":")[0]) : 18;

  const { count: convCount } = await admin
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("created_at", sinceIso);

  return ok(
    {
      days,
      funnel,
      leads_total: leadsTotal,
      won_count: wonCount,
      conversion_pct: leadsTotal > 0 ? Math.round((wonCount / leadsTotal) * 100) : 0,
      score_buckets: scoreBuckets,
      ai: { replies: aiReplies, handoffs, followup_runs: followupRuns },
      conversations: convCount ?? 0,
      inbound_total: inboundTotal,
      followups_sent: followupsSent,
      hourly,
      business_hours: { start: startHour, end: endHour },
      capped,
    },
    { requestId },
  );
}
