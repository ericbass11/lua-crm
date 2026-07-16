/**
 * Recuperação de conhecimento (RAG) para o runtime do agente.
 *
 * Embed da pergunta do cliente → retrieve_top_k_chunks na versão de KB ativa
 * do agente → bloco de contexto para o modelo responder ancorado nos
 * documentos da empresa (não improvisar).
 *
 * Degradação graciosa: sem chave de embedding (AI_GATEWAY_API_KEY/OPENAI_API_KEY)
 * ou sem KB ativa → retorna "" e o agente responde sem RAG.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { embedText } from "@/lib/ai/embed";
import { isEmbeddingProviderConfigured } from "@/lib/ai/gateway";

const TOP_K = 5;
const THRESHOLD = 0.72;

interface RpcRow {
  content: string;
  similarity: number;
}

export async function retrieveKnowledge(params: {
  admin: SupabaseClient;
  organizationId: string;
  kbVersionId: string | null;
  query: string;
}): Promise<string> {
  const { admin, organizationId, kbVersionId, query } = params;
  if (!kbVersionId || !query.trim() || !isEmbeddingProviderConfigured()) return "";

  let embedding: number[];
  try {
    const { embedding: e } = await embedText(query, { organizationId });
    embedding = e;
  } catch {
    return "";
  }

  const { data, error } = await admin.rpc("retrieve_top_k_chunks" as never, {
    p_organization_id: organizationId,
    p_kb_version_id: kbVersionId,
    p_embedding: embedding as unknown as string,
    p_k: TOP_K,
    p_threshold: THRESHOLD,
  } as never);
  if (error) return "";

  const rows = (data ?? []) as RpcRow[];
  if (rows.length === 0) return "";

  const blocks = rows.map((r, i) => `[${i + 1}] ${r.content.trim()}`).join("\n\n");
  return (
    "BASE DE CONHECIMENTO DA EMPRESA (use para responder com precisão; se a resposta " +
    "não estiver aqui, seja honesta e não invente):\n" +
    blocks
  );
}
