/**
 * Notificação de handoff ao time — best-effort, nunca lança (não pode quebrar
 * o handoff). Dois canais, ambos opcionais e configuráveis por org:
 *  - webhook (Slack/Discord/n8n/custom): POST JSON.
 *  - WhatsApp: mensagem enviada pelo número do negócio (WAHA) para o número do
 *    time cadastrado.
 * Ambos levam motivo + link + resumo da conversa (campo `resumo` do lead, com
 * fallback para a última mensagem do cliente).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { getWahaClient } from "@/lib/waha/client";

export interface HandoffNotifyInput {
  organizationId: string;
  conversationId: string;
  contactId?: string | null;
  reason: string;
  contactName?: string | null;
  contactPhone?: string | null;
  appUrl?: string | null;
}

const REASON_LABEL: Record<string, string> = {
  requested_human: "cliente pediu atendente",
  sentiment_negative: "cliente irritado/insatisfeito",
  low_confidence: "IA sem confiança na resposta",
  tool_failure: "falha de ferramenta",
  requested_human_tool: "IA acionou handoff",
};

/** Resumo da conversa: campo `resumo` do lead ou a última mensagem do cliente. */
async function buildSummary(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
  contactId: string | null | undefined,
): Promise<string | null> {
  if (contactId) {
    const { data: lead } = await admin
      .from("crm_leads")
      .select("custom_fields")
      .eq("organization_id", organizationId)
      .eq("contact_id", contactId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const resumo = (lead as { custom_fields: Record<string, unknown> | null } | null)?.custom_fields?.[
      "resumo"
    ];
    if (typeof resumo === "string" && resumo.trim()) return resumo.trim();
  }
  const { data: msg } = await admin
    .from("messages")
    .select("body")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const body = (msg as { body: string | null } | null)?.body;
  return body ? `Última mensagem do cliente: "${body.slice(0, 200)}"` : null;
}

function toChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}@c.us`;
}

export async function notifyHandoff(
  admin: SupabaseClient,
  input: HandoffNotifyInput,
): Promise<void> {
  let webhookUrl: string | null = null;
  let whatsappNumber: string | null = null;
  try {
    const { data } = await admin
      .from("notification_settings")
      .select("handoff_webhook_url, handoff_whatsapp_number, handoff_enabled")
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    const row = data as {
      handoff_webhook_url: string | null;
      handoff_whatsapp_number: string | null;
      handoff_enabled: boolean;
    } | null;
    if (!row?.handoff_enabled) return;
    webhookUrl = row.handoff_webhook_url?.trim() || null;
    whatsappNumber = row.handoff_whatsapp_number?.trim() || null;
  } catch {
    return;
  }
  if (!webhookUrl && !whatsappNumber) return;

  const who = input.contactName || input.contactPhone || "um cliente";
  const motivo = REASON_LABEL[input.reason] ?? input.reason;
  const link = input.appUrl
    ? `${input.appUrl.replace(/\/$/, "")}/app/inbox/${input.conversationId}`
    : null;
  const summary = await buildSummary(admin, input.organizationId, input.conversationId, input.contactId);

  const text =
    `🔔 *Atendimento humano necessário*\n` +
    `${who} precisa de um humano (motivo: ${motivo}).` +
    (summary ? `\n\n📋 ${summary}` : "") +
    (link ? `\n\n👉 ${link}` : "");

  // Canal 1 — webhook (Slack/Discord/n8n/custom).
  if (webhookUrl && /^https?:\/\//.test(webhookUrl)) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          content: text,
          event: "handoff_pending",
          conversation_id: input.conversationId,
          organization_id: input.organizationId,
          reason: input.reason,
          contact_name: input.contactName ?? null,
          contact_phone: input.contactPhone ?? null,
          summary,
          url: link,
        }),
      });
    } catch {
      /* best-effort */
    }
  }

  // Canal 2 — WhatsApp: número do negócio (WAHA) → número do time.
  if (whatsappNumber) {
    try {
      const { data: sess } = await admin
        .from("channel_sessions")
        .select("waha_session_name")
        .eq("organization_id", input.organizationId)
        .eq("status", "WORKING")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const sessionName = (sess as { waha_session_name: string } | null)?.waha_session_name;
      const waha = getWahaClient();
      if (sessionName && waha) {
        // Múltiplos números separados por vírgula.
        for (const num of whatsappNumber.split(",").map((n) => n.trim()).filter(Boolean)) {
          await waha.sendMessage(sessionName, toChatId(num), text);
        }
      }
    } catch {
      /* best-effort */
    }
  }
}
