/**
 * Tool MCP — crm_tag_conversation.
 *
 * Aplica/remove tags do catálogo da org (`tag_definitions`) numa conversa.
 * Somente tags CADASTRADAS são aceitas — a IA recebe o catálogo (nome +
 * "quando usar") injetado no contexto do runtime e decide com base no
 * histórico da conversa. Tags fora do catálogo são recusadas com a lista
 * válida, para o modelo se corrigir.
 */
import { z } from "zod";

import type { McpToolDefinition } from "../types";

const tagShape = {
  conversation_id: z.string().uuid().describe("ID da conversa (vem do contexto do sistema)."),
  add_tags: z
    .array(z.string().trim().min(1).max(40))
    .max(10)
    .optional()
    .default([])
    .describe("Tags do catálogo a ADICIONAR."),
  remove_tags: z
    .array(z.string().trim().min(1).max(40))
    .max(10)
    .optional()
    .default([])
    .describe("Tags a REMOVER (quando deixaram de se aplicar)."),
};

export const crmTagConversation: McpToolDefinition<typeof tagShape> = {
  name: "crm_tag_conversation",
  description:
    "Adiciona/remove TAGs na conversa com base no catálogo da organização. Use quando a conversa se encaixar na descrição de uma tag cadastrada. Nunca invente tags fora do catálogo.",
  inputSchema: tagShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    if (input.add_tags.length === 0 && input.remove_tags.length === 0) {
      return { error: "Informe add_tags e/ou remove_tags." };
    }

    const { data: defs, error: defsErr } = await ctx.supabase
      .from("tag_definitions")
      .select("name")
      .eq("organization_id", ctx.organizationId);
    if (defsErr) return { error: `Falha ao carregar catálogo: ${defsErr.message}` };
    const valid = new Set((defs ?? []).map((d) => (d as { name: string }).name.toLowerCase()));

    const invalid = input.add_tags.filter((t) => !valid.has(t.toLowerCase()));
    if (invalid.length > 0) {
      return {
        error: `Tags fora do catálogo: ${invalid.join(", ")}. Válidas: ${[...valid].join(", ") || "(nenhuma cadastrada)"}.`,
      };
    }

    const { data: conv, error: convErr } = await ctx.supabase
      .from("conversations")
      .select("id, tags")
      .eq("id", input.conversation_id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (convErr || !conv) return { error: "Conversa não encontrada." };

    const current = ((conv as { tags: string[] | null }).tags ?? []).map((t) => t);
    const removeSet = new Set(input.remove_tags.map((t) => t.toLowerCase()));
    const next = [
      ...current.filter((t) => !removeSet.has(t.toLowerCase())),
      ...input.add_tags.filter((t) => !current.some((c) => c.toLowerCase() === t.toLowerCase())),
    ];

    const { error: updErr } = await ctx.supabase
      .from("conversations")
      .update({ tags: next, updated_at: new Date().toISOString() })
      .eq("id", input.conversation_id)
      .eq("organization_id", ctx.organizationId);
    if (updErr) return { error: `Falha ao gravar tags: ${updErr.message}` };

    return { tagged: true, tags: next };
  },
};
