/**
 * Follow-up dispatcher — sequência de reengajamento por inatividade.
 *
 * Rodado pelo cron /api/v1/cron/followup-dispatcher (1/min). Para cada org com
 * `followup_settings.enabled`:
 *
 *   1. Janela de envio (dias/horário no fuso da org — anti-banimento).
 *   2. Conversas onde o BOT falou por último (last_outbound_at > last_inbound_at),
 *      sem humano atribuído, sem silêncio de handoff, contato ok, 1:1.
 *   3. Passo atual = nº de follow-ups já enviados desde a última resposta do
 *      cliente (derivado de messages.metadata.followup_step — cliente respondeu
 *      → contagem zera → ciclo reinicia sozinho, sem estado persistido).
 *   4. Se inatividade >= delay do passo → cria run de agente com is_followup
 *      e a instrução do passo; o runtime gera a mensagem personalizada com o
 *      histórico da conversa.
 *
 * Guarda-corpos: budget da org, 1 run por conversa (unique index), batch cap.
 */
import { randomUUID } from "node:crypto";

import { checkTenantBudget } from "@/lib/ai/dispatcher/budget";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export interface FollowupStep {
  delay_minutes: number;
  hint?: string;
}

interface FollowupSettingsRow {
  organization_id: string;
  enabled: boolean;
  timezone: string;
  send_window: { days: number[]; start: string; end: string };
  steps: FollowupStep[];
}

export interface FollowupStats {
  orgs_enabled: number;
  conversations_checked: number;
  dispatched: number;
  skipped_window: number;
  skipped_budget: number;
  errors: string[];
}

const BATCH_CAP = 10;

function nowInWindow(tz: string, window: { days: number[]; start: string; end: string }): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[map.weekday as string] ?? 0;
  if (!window.days.includes(weekday)) return false;
  const hhmm = `${map.hour === "24" ? "00" : map.hour}:${map.minute}`;
  return hhmm >= window.start && hhmm <= window.end;
}

function buildInstruction(
  stepIndex: number,
  total: number,
  hint: string | undefined,
  silentMinutes: number,
  leadContext: string | null,
): string {
  const isLast = stepIndex + 1 >= total;
  return [
    "[INSTRUÇÃO INTERNA DO SISTEMA — o cliente NÃO enviou mensagem nova; isto NÃO é uma mensagem do cliente]",
    `O cliente está sem responder há ~${silentMinutes} minutos. Envie agora UMA mensagem curta de follow-up (máx. 3 linhas), personalizada com base no histórico da conversa acima.`,
    `Este é o follow-up ${stepIndex + 1} de ${total} do ciclo.`,
    hint ? `Orientação desta etapa: ${hint}` : null,
    // Follow-up ciente do funil: o tom acompanha onde o lead está.
    leadContext,
    "Regras: não repita follow-ups anteriores; não peça desculpas por insistir; não diga que é um lembrete automático; conecte com o último assunto da conversa.",
    isLast
      ? "Como é a ÚLTIMA tentativa do ciclo: encerre cordialmente deixando a porta aberta, sem pressionar."
      : "Termine com uma pergunta leve ou um convite claro (fácil de responder).",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Contexto do lead (etapa + campos) para o follow-up casar o tom com o funil. */
async function loadLeadContext(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  contactId: string | null,
): Promise<string | null> {
  if (!contactId) return null;
  const { data } = await admin
    .from("crm_leads")
    .select("custom_fields, crm_stages:stage_id(name, is_won, is_lost)")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    custom_fields: Record<string, unknown> | null;
    crm_stages: { name: string } | Array<{ name: string }> | null;
  };
  const stage = Array.isArray(row.crm_stages) ? row.crm_stages[0] : row.crm_stages;
  const cf = row.custom_fields ?? {};
  const bits = [
    stage?.name ? `etapa do funil: ${stage.name}` : null,
    cf["dor_principal"] ? `dor: ${cf["dor_principal"]}` : null,
    cf["proximo_passo"] ? `próximo passo combinado: ${cf["proximo_passo"]}` : null,
    cf["urgencia"] ? `urgência: ${cf["urgencia"]}` : null,
  ].filter(Boolean);
  if (bits.length === 0) return null;
  return `Contexto do lead (adeque o TOM a isto — quente puxa pra ação, frio reaquece com valor): ${bits.join("; ")}.`;
}

export async function runFollowupDispatcher(): Promise<FollowupStats> {
  const admin = createAdminClient();
  const stats: FollowupStats = {
    orgs_enabled: 0,
    conversations_checked: 0,
    dispatched: 0,
    skipped_window: 0,
    skipped_budget: 0,
    errors: [],
  };

  const { data: settingsRows, error: settingsErr } = await admin
    .from("followup_settings")
    .select("organization_id, enabled, timezone, send_window, steps")
    .eq("enabled", true);
  if (settingsErr) {
    stats.errors.push(`settings: ${settingsErr.message}`);
    return stats;
  }

  for (const raw of (settingsRows ?? []) as unknown as FollowupSettingsRow[]) {
    stats.orgs_enabled += 1;
    const steps = Array.isArray(raw.steps) ? raw.steps.filter((s) => s?.delay_minutes > 0) : [];
    if (steps.length === 0) continue;

    if (!nowInWindow(raw.timezone || "America/Sao_Paulo", raw.send_window)) {
      stats.skipped_window += 1;
      continue;
    }

    const budget = await checkTenantBudget(raw.organization_id);
    if (!budget.ok) {
      stats.skipped_budget += 1;
      continue;
    }

    // Conversas candidatas: empresa falou por último, sem silêncio de handoff.
    // 'claimed' (humano atendendo) TAMBÉM recebe follow-up — a IA envia apenas
    // a mensagem de reengajamento; ela NÃO assume a conversa: quando o cliente
    // responder, o gate skipped_human_active do agent-dispatcher mantém a IA
    // muda enquanto houver atendente atribuído.
    const { data: convRows, error: convErr } = await admin
      .from("conversations")
      .select(
        "id, organization_id, channel_session_id, contact_id, status, last_inbound_at, last_outbound_at, last_message_at, assigned_to_user_id, bot_silenced_until, is_group, contacts:contact_id(force_human, is_blocked)",
      )
      .eq("organization_id", raw.organization_id)
      .eq("is_group", false)
      .in("status", ["open", "ai_handling", "claimed"])
      .not("last_outbound_at", "is", null)
      .order("last_message_at", { ascending: true })
      .limit(200);
    if (convErr) {
      stats.errors.push(`conversations: ${convErr.message}`);
      continue;
    }

    let dispatchedThisOrg = 0;
    for (const convRaw of convRows ?? []) {
      if (dispatchedThisOrg >= BATCH_CAP) break;
      const conv = convRaw as unknown as {
        id: string;
        organization_id: string;
        channel_session_id: string;
        contact_id: string | null;
        last_inbound_at: string | null;
        last_outbound_at: string | null;
        last_message_at: string | null;
        bot_silenced_until: string | null;
        contacts:
          | { force_human: boolean | null; is_blocked: boolean | null }
          | Array<{ force_human: boolean | null; is_blocked: boolean | null }>
          | null;
      };
      stats.conversations_checked += 1;

      const contact = Array.isArray(conv.contacts) ? conv.contacts[0] ?? null : conv.contacts;
      if (contact?.is_blocked || contact?.force_human) continue;
      if (conv.bot_silenced_until && new Date(conv.bot_silenced_until).getTime() > Date.now()) continue;

      const lastOut = conv.last_outbound_at ? Date.parse(conv.last_outbound_at) : 0;
      const lastIn = conv.last_inbound_at ? Date.parse(conv.last_inbound_at) : 0;
      // Follow-up só quando o bot/empresa falou por último E já houve resposta
      // do cliente alguma vez (conversa viva, não cold outreach).
      if (!lastOut || lastOut <= lastIn || !lastIn) continue;

      const lastMsgAt = conv.last_message_at ? Date.parse(conv.last_message_at) : lastOut;

      // Passo atual: follow-ups já enviados desde a última resposta do cliente.
      const { count, error: countErr } = await admin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conv.id)
        .eq("organization_id", conv.organization_id)
        .eq("direction", "outbound")
        .not("metadata->>followup_step", "is", null)
        .gt("created_at", conv.last_inbound_at as string);
      if (countErr) {
        stats.errors.push(`count ${conv.id}: ${countErr.message}`);
        continue;
      }
      const stepIndex = count ?? 0;
      if (stepIndex >= steps.length) continue; // sequência esgotada — retoma quando o cliente responder

      const step = steps[stepIndex] as FollowupStep;
      const silentMs = Date.now() - lastMsgAt;
      if (silentMs < step.delay_minutes * 60_000) continue; // ainda não deu o tempo

      // Concorrência: run ativo nessa conversa? Janela de 15min — um run
      // 'pending'/'running' mais velho que isso é zumbi (runner nunca rodou ou
      // morreu) e NÃO pode bloquear a conversa para sempre.
      const { data: running } = await admin
        .from("ai_agent_runs")
        .select("id")
        .eq("organization_id", conv.organization_id)
        .eq("conversation_id", conv.id)
        .in("status", ["pending", "running"])
        .eq("is_dry_run", false)
        .gt("started_at", new Date(Date.now() - 15 * 60_000).toISOString())
        .limit(1)
        .maybeSingle();
      if (running) continue;

      // Agente publicado vinculado à sessão desta conversa (maior prioridade).
      const agent = await pickAgent(conv.organization_id, conv.channel_session_id);
      if (!agent) continue;

      const leadContext = await loadLeadContext(admin, conv.organization_id, conv.contact_id);
      const runId = randomUUID();
      const { error: insertErr } = await admin.from("ai_agent_runs").insert({
        id: runId,
        organization_id: conv.organization_id,
        agent_id: agent.agent_id,
        agent_version_id: agent.version_id,
        conversation_id: conv.id,
        contact_id: conv.contact_id,
        channel_session_id: conv.channel_session_id,
        inbound_message_id: null,
        status: "pending",
        is_dry_run: false,
        is_followup: true,
        followup_step: stepIndex + 1,
        followup_hint: buildInstruction(
          stepIndex,
          steps.length,
          step.hint,
          Math.round(silentMs / 60_000),
          leadContext,
        ),
      });
      if (insertErr) {
        if (insertErr.code !== "23505") stats.errors.push(`run ${conv.id}: ${insertErr.message}`);
        continue;
      }

      await invokeRunner(runId);
      stats.dispatched += 1;
      dispatchedThisOrg += 1;
    }
  }

  return stats;
}

async function pickAgent(
  orgId: string,
  channelSessionId: string,
): Promise<{ agent_id: string; version_id: string } | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_agents")
    .select(
      "id, priority, created_at, archived_at, published_version_id, version:ai_agent_versions!ai_agents_published_version_id_fkey(id, status, channel_session_id)",
    )
    .eq("organization_id", orgId)
    .is("archived_at", null)
    .not("published_version_id", "is", null)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  for (const row of data ?? []) {
    const v = Array.isArray(row.version) ? row.version[0] : row.version;
    if (v && v.status === "published" && v.channel_session_id === channelSessionId) {
      return { agent_id: row.id as string, version_id: v.id as string };
    }
  }
  return null;
}

async function invokeRunner(runId: string): Promise<void> {
  const secret = env.INTERNAL_SECRET;
  if (!secret) {
    logger.warn("[followup-dispatcher] INTERNAL_SECRET missing — runner not invoked", { run_id: runId });
    return;
  }
  const baseUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const url = `${baseUrl.replace(/\/$/, "")}/api/internal/agents/run`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ run_id: runId }),
    });
  } catch (err) {
    logger.warn("[followup-dispatcher] runner invoke failed", {
      run_id: runId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}
