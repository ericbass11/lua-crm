/**
 * lib/mystery/insight.ts — Fase 3 (RAG/insights de venda) do Cliente Oculto.
 *   - generateInsight: argumento de venda cirúrgico por empresa, a partir do
 *     laudo real (métricas + problemas observados).
 *   - askReports: Q&A sobre TODOS os laudos auditados (padrões, comparações).
 *
 * Escala atual: alimenta o LLM com os dados estruturados (RAG "de contexto").
 * Quando o volume crescer, trocar por embeddings/vetores (ai_chunks-like).
 */
import { generateText } from "ai";

import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrgLlm } from "./model";

type Admin = ReturnType<typeof createAdminClient>;

interface Metrics {
  economy_percent?: number;
  avg_target_response_seconds?: number;
  total_seconds?: number;
  lost_minutes_per_service?: number;
}
interface Analysis {
  quality_issues?: Array<{ quote?: string; problem?: string; suggestion?: string }>;
  conclusion?: string;
}

function fmtSecs(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 60) return `${Math.round(n)}s`;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return s ? `${m}min ${s}s` : `${m}min`;
}

function campaignContext(row: {
  target_name: string | null;
  city: string | null;
  state: string | null;
  metrics: Metrics | null;
  analysis: Analysis | null;
}): string {
  const m = row.metrics ?? {};
  const a = row.analysis ?? {};
  const issues = (a.quality_issues ?? [])
    .slice(0, 6)
    .map((i) => `- "${i.quote ?? ""}": ${i.problem ?? ""}`)
    .join("\n");
  return [
    `Empresa: ${row.target_name ?? "(sem nome)"}${row.city || row.state ? ` (${[row.city, row.state].filter(Boolean).join("/")})` : ""}`,
    `Tempo médio de resposta: ${fmtSecs(m.avg_target_response_seconds)}`,
    `Tempo total até a oferta de horário: ${fmtSecs(m.total_seconds)}`,
    `Tempo perdido por atendimento: ${m.lost_minutes_per_service != null ? Math.round(m.lost_minutes_per_service) + " min" : "—"}`,
    `Economia potencial com a Lua CRM: ${m.economy_percent != null ? m.economy_percent.toFixed(1) + "%" : "—"}`,
    issues ? `Problemas observados na comunicação:\n${issues}` : "",
    a.conclusion ? `Conclusão do laudo: ${a.conclusion}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Gera e persiste o insight de venda de UMA empresa auditada. */
export async function generateInsight(
  organizationId: string,
  campaignId: string,
  adminIn?: Admin,
): Promise<string | null> {
  const admin = adminIn ?? createAdminClient();
  const { data } = await admin
    .from("mystery_shopper_campaigns")
    .select("id, target_name, city, state, metrics, analysis")
    .eq("id", campaignId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    target_name: string | null;
    city: string | null;
    state: string | null;
    metrics: Metrics | null;
    analysis: Analysis | null;
  };

  const llm = await loadOrgLlm(organizationId);
  if (!llm) return null;

  const system = [
    "Você é um consultor de vendas da Lua CRM (plataforma com Agente de IA para atendimento no WhatsApp).",
    "Com base na auditoria REAL de atendimento desta empresa (números medidos + problemas observados), escreva um INSIGHT DE VENDA curto e cirúrgico (3 a 5 frases) para um vendedor usar ao abordá-la.",
    "Estruture: (1) o gargalo real observado (tempo de resposta/erros de comunicação); (2) o impacto no negócio (pacientes/leads perdidos por demora, tempo desperdiçado); (3) como o Agente de IA da Lua CRM resolve (resposta em ~3s, 24/7, agendamento em ~5min, economia de X%); (4) um gancho de abordagem concreto para iniciar a conversa comercial.",
    "Baseie-se SOMENTE nos dados fornecidos — não invente números nem fatos. Tom consultivo, direto e persuasivo. Responda só com o texto do insight, sem títulos.",
  ].join(" ");

  try {
    const res = await generateText({
      model: llm.model,
      system,
      messages: [{ role: "user", content: campaignContext(row) }],
    });
    const insight = (res.text ?? "").trim();
    if (!insight) return null;
    await admin
      .from("mystery_shopper_campaigns")
      .update({ insight, insight_at: new Date().toISOString() })
      .eq("id", campaignId);
    return insight;
  } catch (err) {
    console.error("[mystery.insight] generate failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Q&A sobre todos os laudos auditados (padrões, comparações, priorização). */
export async function askReports(organizationId: string, question: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("mystery_shopper_campaigns")
    .select("target_name, city, state, stage, metrics, analysis")
    .eq("organization_id", organizationId)
    .not("stage", "is", null)
    .order("stage_changed_at", { ascending: false })
    .limit(80);
  const rows = (data as Array<Parameters<typeof campaignContext>[0] & { stage: string }> | null) ?? [];
  if (rows.length === 0) return "Ainda não há empresas auditadas para analisar.";

  const llm = await loadOrgLlm(organizationId);
  if (!llm) return "IA indisponível (sem credencial de agente publicado na organização).";

  const corpus = rows
    .map((r, i) => `### Laudo ${i + 1} (etapa: ${r.stage})\n${campaignContext(r)}`)
    .join("\n\n");
  const system = [
    "Você é um analista comercial da Lua CRM. Responda à pergunta do usuário USANDO SOMENTE os laudos de auditoria de atendimento fornecidos abaixo.",
    "Cite empresas específicas quando relevante, compare números e aponte oportunidades de venda do Agente de IA. Se os dados não permitirem responder, diga isso claramente. Seja objetivo e prático.",
  ].join(" ");

  try {
    const res = await generateText({
      model: llm.model,
      system,
      messages: [{ role: "user", content: `Pergunta: ${question}\n\nLaudos:\n${corpus}` }],
    });
    return (res.text ?? "").trim() || "Não consegui gerar uma resposta.";
  } catch (err) {
    return `Falha ao consultar os laudos: ${err instanceof Error ? err.message : String(err)}`;
  }
}
