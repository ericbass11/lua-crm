/**
 * lib/mystery/report.ts — Fase 3: gera o laudo (Lua) + a transcrição da
 * campanha do Cliente Oculto e entrega os 2 PDFs ao número cadastrado.
 *
 * Consumido por mystery_shopper.completed (event-log-drain). Idempotente: se o
 * laudo já foi gerado (report_storage_path preenchido), não refaz.
 */
import { generateText } from "ai";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeToE164 } from "@/lib/phone";
import { getWahaClient } from "@/lib/waha/client";
import { audit } from "@/lib/audit";
import { loadOrgLlm } from "./model";
import { generateInsight } from "./insight";
import {
  computeConversationMetrics,
  computeOperationalImpact,
  humanizeMinutes,
  humanizeSeconds,
  type TimedMessage,
} from "./metrics";
import {
  renderReportPdf,
  renderTranscriptPdf,
  type ReportData,
  type ReportQualityIssue,
  type TranscriptData,
} from "./pdf";

type Admin = ReturnType<typeof createAdminClient>;
const BUCKET = "mystery-reports";

interface CampaignRow {
  id: string;
  organization_id: string;
  shopper_session_id: string;
  target_name: string | null;
  recipient_number: string;
  started_at: string;
  ended_at: string | null;
  slot_offered_at: string | null;
  report_storage_path: string | null;
  city: string | null;
  state: string | null;
}

interface MsgRow {
  direction: "shopper" | "target";
  body: string | null;
  sent_at: string;
}

function fmtDateLabel(startIso: string, endIso: string | null): string {
  const tz = "America/Sao_Paulo";
  const start = new Date(startIso);
  const weekday = start.toLocaleDateString("pt-BR", { weekday: "long", timeZone: tz });
  const date = start.toLocaleDateString("pt-BR", { timeZone: tz });
  const st = start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const cap = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  if (!endIso) return `${cap}, ${date} (Início ${st})`;
  const et = new Date(endIso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  return `${cap}, ${date} (Início ${st}; Término ${et})`;
}

function fmtTurnAt(iso: string): string {
  const tz = "America/Sao_Paulo";
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: tz });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  return `${date} ${time}`;
}

interface Analysis {
  qualityIssues: ReportQualityIssue[];
  conclusion: string;
}

interface AnalysisCtx {
  avgResponseLabel: string;
  totalLabel: string;
  lostPerServiceLabel: string;
  monthlyLabel: string;
  economyPct: string;
}

async function analyzeTranscript(
  organizationId: string,
  targetName: string,
  transcript: string,
  ctx: AnalysisCtx,
): Promise<Analysis> {
  // Conclusão "cirúrgica": realidade da clínica x IA da Lua CRM, sem mentir.
  const fallbackConclusion =
    `A ${targetName} respondeu em média em ${ctx.avgResponseLabel} e levou ${ctx.totalLabel} até oferecer um horário. ` +
    `É um atendimento humano funcional, mas que custa ${ctx.lostPerServiceLabel} por contato e projeta cerca de ${ctx.monthlyLabel} de tempo perdido por mês. ` +
    `Com a IA da Lua CRM respondendo no WhatsApp em ~3 segundos, 24 horas por dia, e conduzindo o agendamento em ~5 minutos, a clínica recuperaria até ${ctx.economyPct}% desse tempo — ` +
    `convertendo mais avaliações em consultas, deixando de perder pacientes pela demora e liberando a equipe. Vale conhecer o que a Lua CRM faria pela sua clínica.`;

  const llm = await loadOrgLlm(organizationId);
  if (!llm) return { qualityIssues: [], conclusion: fallbackConclusion };

  const system = [
    "Você é um consultor sênior de atendimento em saúde. Analise SOMENTE as mensagens da CLÍNICA (não as do Paciente) na transcrição e liste até 8 problemas de comunicação (erros de português, frases confusas, informalidade excessiva, falta de pontuação); para cada um, cite o trecho literal, o problema e uma sugestão profissional.",
    "Escreva também uma CONCLUSÃO de 1 parágrafo — CIRÚRGICA e persuasiva, SEM MENTIR — cujo objetivo é fazer a clínica concluir que precisa contratar a Lua CRM para atender o WhatsApp.",
    `NÚMEROS REAIS MEDIDOS DA CLÍNICA: tempo médio de resposta = ${ctx.avgResponseLabel}; tempo total até a oferta de horário = ${ctx.totalLabel}; tempo perdido por atendimento = ${ctx.lostPerServiceLabel}; perda mensal projetada = ${ctx.monthlyLabel}.`,
    `BENCHMARK DA LUA CRM (comparativo, NÃO é o desempenho da clínica): resposta ~3 segundos, atendimento total ~5 minutos, economia potencial = ${ctx.economyPct}%.`,
    "A conclusão DEVE: (1) reconhecer o desempenho real da clínica com respeito, usando os números reais acima; (2) expor o CUSTO disso (perda por atendimento e projeção mensal); (3) contrastar com a IA da Lua CRM (resposta em ~3s, 24/7, agendamento em ~5min, economia de X%); (4) traduzir em benefício concreto: mais avaliações viram consultas, menos pacientes perdidos por demora, equipe liberada; (5) fechar convidando a conhecer a Lua CRM.",
    "NUNCA atribua os números da Lua CRM (3s/5min) à clínica — são o comparativo. Tom consultivo, direto, profissional.",
    "Responda SOMENTE em JSON válido, sem markdown:",
    '{"qualityIssues":[{"quote":"...","problem":"...","suggestion":"..."}],"conclusion":"..."}',
  ].join(" ");

  try {
    const res = await generateText({
      model: llm.model,
      system,
      messages: [{ role: "user", content: `Clínica: ${targetName}\n\nTranscrição:\n${transcript}` }],
    });
    const cleaned = (res.text ?? "").replace(/```json/gi, "").replace(/```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const parsed = JSON.parse(start >= 0 ? cleaned.slice(start, end + 1) : cleaned) as Partial<Analysis>;
    const issues = Array.isArray(parsed.qualityIssues)
      ? parsed.qualityIssues
          .filter((i) => i && typeof i.quote === "string")
          .slice(0, 8)
          .map((i) => ({
            quote: String(i.quote),
            problem: String(i.problem ?? ""),
            suggestion: String(i.suggestion ?? ""),
          }))
      : [];
    return {
      qualityIssues: issues,
      conclusion: typeof parsed.conclusion === "string" && parsed.conclusion.trim()
        ? parsed.conclusion.trim()
        : fallbackConclusion,
    };
  } catch (err) {
    console.error("[mystery.report] analysis failed", err instanceof Error ? err.message : String(err));
    return { qualityIssues: [], conclusion: fallbackConclusion };
  }
}

async function uploadPdf(admin: Admin, path: string, buffer: Buffer): Promise<void> {
  await admin.storage.from(BUCKET).upload(path, buffer, {
    contentType: "application/pdf",
    upsert: true,
  });
}

async function signedUrl(admin: Admin, path: string): Promise<string | null> {
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 72 * 60 * 60);
  return data?.signedUrl ?? null;
}

export async function generateAndDeliverReport(
  organizationId: string,
  campaignId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data: campRaw } = await admin
    .from("mystery_shopper_campaigns")
    .select(
      "id, organization_id, shopper_session_id, target_name, recipient_number, started_at, ended_at, slot_offered_at, report_storage_path, city, state",
    )
    .eq("id", campaignId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const campaign = campRaw as CampaignRow | null;
  if (!campaign) return;
  if (campaign.report_storage_path) return; // idempotente — já gerado

  const { data: msgRaw } = await admin
    .from("mystery_shopper_messages")
    .select("direction, body, sent_at")
    .eq("campaign_id", campaignId)
    .order("sent_at", { ascending: true });
  const messages = (msgRaw as MsgRow[] | null) ?? [];

  const targetName = campaign.target_name ?? "a empresa avaliada";

  // Métricas.
  const metrics = computeConversationMetrics(
    messages as TimedMessage[],
    campaign.slot_offered_at,
  );
  const totalMinutes = (metrics.totalSeconds ?? 0) / 60;
  const impact = computeOperationalImpact(totalMinutes);
  const economyPct = impact.economyPercent.toFixed(2).replace(".", ",");
  const totalLabel = metrics.totalSeconds != null ? humanizeSeconds(metrics.totalSeconds) : "—";

  // Transcrição (texto + estrutura pro PDF).
  const lines = messages.map((m) => ({
    at: fmtTurnAt(m.sent_at),
    role: (m.direction === "shopper" ? "Paciente" : "Clínica") as "Paciente" | "Clínica",
    text: m.body ?? "",
  }));
  const transcriptText = lines.map((l) => `[${l.at}] ${l.role}: ${l.text}`).join("\n");

  const avgResponseLabel =
    metrics.avgTargetResponseSeconds != null ? humanizeSeconds(metrics.avgTargetResponseSeconds) : "—";
  const analysis = await analyzeTranscript(organizationId, targetName, transcriptText, {
    avgResponseLabel,
    totalLabel,
    lostPerServiceLabel: humanizeMinutes(impact.lostMinutesPerService),
    monthlyLabel: humanizeMinutes(impact.monthlyLostMinutes),
    economyPct,
  });

  const reportData: ReportData = {
    targetName,
    dateLabel: fmtDateLabel(campaign.started_at, campaign.ended_at),
    attendantName: "Não informado",
    targetAvgResponseLabel: avgResponseLabel,
    totalLabel,
    qualityIssues: analysis.qualityIssues,
    impact: {
      lostPerServiceLabel: humanizeMinutes(impact.lostMinutesPerService),
      dailyLabel: humanizeMinutes(impact.dailyLostMinutes),
      weeklyLabel: humanizeMinutes(impact.weeklyLostMinutes),
      monthlyLabel: humanizeMinutes(impact.monthlyLostMinutes),
      economyPercent: economyPct,
    },
    conclusion: analysis.conclusion,
  };
  const transcriptData: TranscriptData = { targetName, lines };

  const reportPdf = await renderReportPdf(reportData);
  const transcriptPdf = await renderTranscriptPdf(transcriptData);

  const reportPath = `mystery/${campaignId}/relatorio.pdf`;
  const transcriptPath = `mystery/${campaignId}/transcricao.pdf`;
  await uploadPdf(admin, reportPath, reportPdf);
  await uploadPdf(admin, transcriptPath, transcriptPdf);

  await admin
    .from("mystery_shopper_campaigns")
    .update({
      report_storage_path: reportPath,
      transcript_storage_path: transcriptPath,
      metrics: {
        avg_target_response_seconds: metrics.avgTargetResponseSeconds,
        total_seconds: metrics.totalSeconds,
        lost_minutes_per_service: impact.lostMinutesPerService,
        economy_percent: impact.economyPercent,
      },
      // Análise estruturada do laudo (base do RAG/insights de venda).
      analysis: {
        quality_issues: analysis.qualityIssues,
        conclusion: analysis.conclusion,
        target_name: targetName,
        city: campaign.city ?? null,
        state: campaign.state ?? null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  // Insight de venda por empresa (best-effort — não bloqueia entrega).
  await generateInsight(organizationId, campaignId, admin).catch(() => null);

  // Entrega via WhatsApp (best-effort — o laudo fica sempre baixável na UI).
  let delivered = false;
  const { data: sessRaw } = await admin
    .from("channel_sessions")
    .select("waha_session_name, status")
    .eq("id", campaign.shopper_session_id)
    .maybeSingle();
  const session = sessRaw as { waha_session_name: string; status: string } | null;
  const waha = getWahaClient();
  // Resolve o chatId REAL do destinatário (trata 9º dígito/LID BR); senão o
  // laudo "envia" mas não é entregue.
  let recipientChat: string | null = null;
  if (waha && session && session.status === "WORKING") {
    const digits = normalizeToE164(campaign.recipient_number)?.e164.replace(/\D/g, "") ?? null;
    if (digits) {
      const r = await waha.checkExists(session.waha_session_name, digits);
      recipientChat = r?.numberExists ? r.chatId : null;
    }
  }

  if (waha && session && session.status === "WORKING" && recipientChat) {
    const reportUrl = await signedUrl(admin, reportPath);
    const transcriptUrl = await signedUrl(admin, transcriptPath);
    try {
      if (reportUrl) {
        await waha.sendFile({
          session: session.waha_session_name,
          chatId: recipientChat,
          url: reportUrl,
          filename: `Cliente Oculto - ${targetName}.pdf`,
          caption: `Relatório do Cliente Oculto — ${targetName}`,
        });
      }
      if (transcriptUrl) {
        await waha.sendFile({
          session: session.waha_session_name,
          chatId: recipientChat,
          url: transcriptUrl,
          filename: `Transcrição - ${targetName}.pdf`,
        });
      }
      delivered = !!reportUrl;
    } catch (err) {
      console.error("[mystery.report] delivery failed", err instanceof Error ? err.message : String(err));
    }
  }

  await audit({
    action: delivered ? "mystery_shopper.report_sent" : "mystery_shopper.report_failed",
    organizationId,
    resourceType: "mystery_shopper_campaign",
    resourceId: campaignId,
    metadata: { delivered, recipient: campaign.recipient_number, economy_percent: economyPct },
  });
}
