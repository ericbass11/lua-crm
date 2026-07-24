/**
 * lib/mystery/model.ts — resolve a config de LLM para o respondedor do Cliente
 * Oculto reusando o agente publicado da org (provider/model/credencial BYO).
 * Não roteia pelo Vercel Gateway (ver doc em agent.ts buildModel): módulo direto
 * por provider com a chave da credencial da org.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { loadCredential } from "@/lib/ai/credentials";
import { createAdminClient } from "@/lib/supabase/admin";

export function buildProviderModel(provider: string, apiKey: string, modelId: string): LanguageModel {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
    default:
      throw new Error(`unsupported_provider:${provider}`);
  }
}

export interface OrgLlm {
  model: LanguageModel;
  provider: string;
  modelId: string;
}

/**
 * Config de LLM do agente publicado da org (default primeiro). Retorna null se
 * a org não tem agente publicado com credencial — o chamador trata como erro.
 */
export async function loadOrgLlm(organizationId: string): Promise<OrgLlm | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ai_agents")
    .select(
      "is_default, published_version_id, version:ai_agent_versions!ai_agents_published_version_id_fkey(provider, model, credential_id)",
    )
    .eq("organization_id", organizationId)
    .not("published_version_id", "is", null)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();

  const vRaw = (data as { version?: unknown } | null)?.version;
  const v = (Array.isArray(vRaw) ? vRaw[0] : vRaw) as
    | { provider: string; model: string; credential_id: string | null }
    | undefined;
  if (!v || !v.credential_id) return null;

  const cred = await loadCredential(v.credential_id, organizationId);
  return {
    model: buildProviderModel(v.provider, cred.apiKey, v.model),
    provider: v.provider,
    modelId: v.model,
  };
}
