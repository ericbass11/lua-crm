/**
 * Tool MCP — crm_set_lead_fields.
 *
 * Preenche/atualiza os campos estratégicos (`custom_fields` jsonb) de um lead
 * com base no histórico da conversa. Merge parcial: só as chaves enviadas são
 * alteradas; enviar null remove a chave.
 *
 * Validação: valores escalares (string/number/boolean/null), ≤30 chaves por
 * chamada, chave ≤40 chars, string ≤500 chars. Se o pipeline declara campos
 * em `settings.fields` (schema declarativo do CLAUDE.md), apenas chaves
 * declaradas são aceitas — senão, livre (MVP Fase 1).
 */
import { z } from "zod";

import type { McpToolDefinition } from "../types";

const scalar = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);

const fieldsShape = {
  lead_id: z.string().uuid(),
  fields: z
    .record(z.string().min(1).max(40), scalar)
    .refine((o) => Object.keys(o).length > 0 && Object.keys(o).length <= 30, {
      message: "Envie de 1 a 30 campos.",
    })
    .describe(
      'Campos estratégicos a gravar (merge). Ex.: {"segmento":"moda","orcamento_declarado":"até R$2000","urgencia":"alta","dor_principal":"depende só de indicação","proximo_passo":"call qui 10h","resumo":"..."}',
    ),
};

export const crmSetLeadFields: McpToolDefinition<typeof fieldsShape> = {
  name: "crm_set_lead_fields",
  description:
    "Preenche/atualiza os campos estratégicos do lead (segmento, orçamento, urgência, dor, objeções, próximo passo, resumo, score etc.) com base na conversa. Merge parcial — envie só o que mudou. Mantenha os campos SEMPRE atualizados.",
  inputSchema: fieldsShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const { data: lead, error: leadErr } = await ctx.supabase
      .from("crm_leads")
      .select("id, pipeline_id, custom_fields")
      .eq("id", input.lead_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (leadErr || !lead) return { error: "Lead não encontrado." };

    // Schema declarativo do pipeline (se existir) restringe as chaves aceitas.
    const { data: pipe } = await ctx.supabase
      .from("crm_pipelines")
      .select("settings")
      .eq("id", (lead as { pipeline_id: string }).pipeline_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const declared = (
      ((pipe as { settings?: { fields?: Array<{ key?: string }> } } | null)?.settings?.fields ?? [])
        .map((f) => f?.key)
        .filter(Boolean) as string[]
    ).map((k) => k.toLowerCase());
    if (declared.length > 0) {
      const invalid = Object.keys(input.fields).filter(
        (k) => !declared.includes(k.toLowerCase()),
      );
      if (invalid.length > 0) {
        return {
          error: `Campos fora do schema do pipeline: ${invalid.join(", ")}. Declarados: ${declared.join(", ")}.`,
        };
      }
    }

    const current = ((lead as { custom_fields: Record<string, unknown> | null }).custom_fields ??
      {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(input.fields)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    if (JSON.stringify(next).length > 8_000) {
      return { error: "custom_fields excederia 8KB — resuma os valores." };
    }

    const { error: updErr } = await ctx.supabase
      .from("crm_leads")
      .update({
        custom_fields: next,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.lead_id)
      .eq("organization_id", ctx.organizationId);
    if (updErr) return { error: `Falha ao gravar: ${updErr.message}` };

    return { updated: true, custom_fields: next };
  },
};
