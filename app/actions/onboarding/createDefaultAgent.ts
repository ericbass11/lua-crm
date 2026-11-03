"use server";

/**
 * Server Action: create the tenant's first ai_agent (default) and stamp the
 * onboarding state. Uses canonical Spec 05 defaults baked into ai_agents.
 */
import { redirect } from "next/navigation";
import { z } from "zod";

import { mcpAgentDraftRecords } from "@/lib/ai/agents/create-draft";
import { capacidadesPadraoDoOnboarding } from "@/lib/ai/agents/capacidades-padrao";
import { escolherModeloDoProvedor } from "@/lib/ai/agents/escolher-modelo";
import { audit } from "@/lib/audit";
import { listSelectableChannels } from "@/lib/channels/selectable";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiAgentDefaultSchema, type PromptTemplate } from "@/lib/schemas/onboarding";
import { publicarMemoriaDaOrg } from "@/lib/ai/memoria-da-org";
import { agentSpecSchemaV1, type AgentSpecV1 } from "@/lib/onboarding/configurador";
import {
  requireOnboardingCtx,
  patchOnboardingState,
  loadOnboardingState,
  OnboardingError,
} from "./_shared";

/**
 * O jeito de falar do funcionário.
 *
 * Os corpos diziam "loja online" e "e-commerce" em dois dos três — num produto
 * que se declara multi-nicho por escrito, e cuja maioria de adopters roda em
 * clínica, imobiliária e infoproduto. Uma clínica terminava o onboarding com um
 * atendente que se apresentava como sendo de uma loja virtual.
 *
 * Recebem o nome do negócio E o ramo: um funcionário que sabe onde trabalha é o
 * mínimo que se espera de alguém contratado, e saber o QUE o lugar faz é a
 * diferença entre "Olá, como posso ajudar?" e uma primeira frase que já mostra
 * que ele entendeu onde está. O ramo é o que o dono respondeu no primeiro passo;
 * quem não respondeu recebe a versão sem ele, e não uma inventada.
 */
function ondeTrabalha(negocio: string, oQueFaz: string | undefined): string {
  return oQueFaz ? `${negocio}, que é: ${oQueFaz}` : negocio;
}

const PROMPT_BODIES: Record<PromptTemplate, (onde: string) => string> = {
  ecommerce_friendly: (n) =>
    `Você atende os clientes de ${n}. Fale de forma calorosa e próxima, como alguém que gosta de ajudar. Cumprimente, entenda o que a pessoa precisa e ofereça opções claras. Confirme os detalhes antes de agir.`,
  ecommerce_professional: (n) =>
    `Você atende os clientes de ${n}. Fale de forma objetiva, cordial e profissional. Vá direto ao ponto, sem parecer frio, e sempre termine indicando o próximo passo.`,
  support_minimal: (n) =>
    `Você atende os clientes de ${n}. Responda em frases curtas, peça apenas o que for necessário e chame uma pessoa do time assim que a dúvida sair do seu alcance.`,
};

function linhasDaSpec(spec: AgentSpecV1): string[] {
  return [
    spec.business.description ? `Descrição aprovada: ${spec.business.description}` : null,
    spec.business.service_area ? `Região atendida: ${spec.business.service_area}` : null,
    spec.business.opening_hours ? `Horário informado: ${spec.business.opening_hours}` : null,
    spec.services.length ? `Serviços oferecidos: ${spec.services.join("; ")}` : null,
    spec.qualification.length
      ? `Informações que deve coletar: ${spec.qualification.join("; ")}`
      : null,
    spec.handoff.triggers.length
      ? `Passe para uma pessoa quando: ${spec.handoff.triggers.join("; ")}`
      : null,
    spec.handoff.summary_fields.length
      ? `Ao passar para uma pessoa, resuma: ${spec.handoff.summary_fields.join("; ")}`
      : null,
    spec.forbidden_topics.length
      ? `Nunca afirme, oriente ou prometa: ${spec.forbidden_topics.join("; ")}`
      : null,
    spec.tone ? `Tom de voz aprovado: ${spec.tone}` : null,
    ...spec.faq.map((item) => `FAQ aprovada — ${item.question}: ${item.answer}`),
  ].filter((linha): linha is string => Boolean(linha));
}

function promptComSpec(base: string, spec: AgentSpecV1 | null): string {
  if (!spec) return base;
  const fatos = linhasDaSpec(spec);
  return fatos.length
    ? `${base}\n\nCONFIGURAÇÃO APROVADA PELO DONO\n${fatos.map((fato) => `- ${fato}`).join("\n")}\nNão invente preço, prazo, serviço, região, horário ou diagnóstico além destes dados.`
    : base;
}

/** O agente padrão desta organização, do jeito que este passo precisa vê-lo. */
interface AgenteDoOnboarding {
  id: string;
  published_version_id: string | null;
}

type DraftOutcome =
  | { drafted: true; versionId: string }
  | { drafted: false; reason: "no_model"; provider: string }
  | { drafted: false; reason: "failed"; message: string };

function provedorDaInstalacao(settings: unknown): string {
  const llm = (settings as { llm?: unknown } | null)?.llm;
  const provider = (llm as { provider?: unknown } | null | undefined)?.provider;
  return typeof provider === "string" && provider.trim() !== "" ? provider : "anthropic";
}

/** Cria (ou reaproveita) a versão inerte que o dono vai ensaiar antes de ativar. */
async function createFirstDraftVersion(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  agent: AgenteDoOnboarding,
  agentName: string,
  systemPrompt: string,
  userId: string,
): Promise<DraftOutcome> {
  const { data: existing, error: existingError } = await admin
    .from("ai_agent_versions")
    .select("id,status,provisioning_origin,version_number,system_prompt")
    .eq("organization_id", orgId)
    .eq("agent_id", agent.id)
    .order("version_number", { ascending: false });
  if (existingError) return { drafted: false, reason: "failed", message: existingError.message };

  const onboardingDraft = existing?.find(
    (version) => version.status === "draft" && version.provisioning_origin === "onboarding",
  );
  if (onboardingDraft?.id) {
    return onboardingDraft.system_prompt === systemPrompt
      ? { drafted: true, versionId: onboardingDraft.id as string }
      : {
          drafted: false,
          reason: "failed",
          message: "existing_version_requires_review",
        };
  }

  // Um rascunho humano nunca é tomado pelo onboarding. O dono precisa revisá-lo
  // no editor, em vez de o wizard criar ou publicar por cima dele.
  if (existing && existing.length > 0) {
    return { drafted: false, reason: "failed", message: "existing_version_requires_review" };
  }

  let canais;
  try {
    canais = await listSelectableChannels(admin, orgId);
  } catch (err) {
    return {
      drafted: false,
      reason: "failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (orgError) return { drafted: false, reason: "failed", message: orgError.message };
  const provider = provedorDaInstalacao(org?.settings);

  const { data: credential } = await admin
    .from("ai_provider_credentials")
    .select("id")
    .eq("organization_id", orgId)
    .eq("provider", provider)
    .eq("is_active", true)
    .not("validated_at", "is", null)
    .limit(1)
    .maybeSingle();

  const { data: models, error: modelsError } = await admin
    .from("ai_models")
    .select(
      "model_id, is_default_for_provider, supports_tools, input_price_per_million_cents, output_price_per_million_cents",
    )
    .eq("provider", provider)
    .is("deprecated_at", null);
  if (modelsError) return { drafted: false, reason: "failed", message: modelsError.message };
  const model = escolherModeloDoProvedor(
    (models ?? []) as Parameters<typeof escolherModeloDoProvedor>[0],
  );
  if (!model.escolhido) return { drafted: false, reason: "no_model", provider };

  const { data: pipeline, error: pipelineError } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .eq("is_archived", false)
    .maybeSingle();
  if (pipelineError) return { drafted: false, reason: "failed", message: pipelineError.message };

  const records = mcpAgentDraftRecords(
    { orgId, userId },
    {
      name: agentName,
      version: {
        system_prompt: systemPrompt,
        provider,
        model: model.modelId,
        credential_id: (credential?.id as string | undefined) ?? null,
        tool_ids: capacidadesPadraoDoOnboarding(),
        pipeline_ids: pipeline?.id ? [pipeline.id as string] : [],
        knowledge_source_ids: [],
        channel_session_id: canais[0]?.id ?? null,
        // O MVP é estritamente inbound: nenhum retorno proativo nasce ligado.
        followup: { enabled: false, flow_pointer_ids: [], send_window: null },
      },
    },
    { agentId: agent.id },
  );

  const { data: inserted, error: insertError } = await admin
    .from("ai_agent_versions")
    .insert({ ...records.version, organization_id: orgId, provisioning_origin: "onboarding" })
    .select("id")
    .single();
  if (insertError || !inserted?.id) {
    return {
      drafted: false,
      reason: "failed",
      message: insertError?.message ?? "version_insert_failed",
    };
  }
  return { drafted: true, versionId: inserted.id as string };
}

/**
 * O que aconteceu com a 1ª versão — e por que "não há canal" e "não deu para
 * saber" são desfechos SEPARADOS.
 *
 * `no_channel` é um estado CONHECIDO do produto: quem pulou o WhatsApp não tem
 * número, a versão exige `channel_session_id`, e o agente fica rascunho de
 * propósito (a lista de agentes já mostra "Rascunho"). `failed` é o estado
 * DESCONHECIDO: a consulta não respondeu, então não se sabe se há canal.
 * Colapsar os dois no mesmo `return` seria engolir erro — e engolir erro aqui
 * significa terminar o onboarding com um agente mudo sem ninguém saber por quê.
 */

export type CreateAgentResult =
  /**
   * O agente existe. `publish_error` presente = ficou RASCUNHO porque não deu
   * para decidir a publicação; ausente = publicado (ou rascunho deliberado por
   * ainda não haver número, caso em que o wizard já seguiu com um `redirect`).
   *
   * Mesmo contrato do passo de convites, que também recusa redirecionar quando
   * a parte que podia falhar falhou (`sendOnboardingInvites` → `undelivered`):
   * avançar calado seria a UI mentindo sobre o que o servidor conseguiu fazer.
   */
  /**
   * `publish_blocked_by` diz à tela QUAL causa explicar. Sem ele, o alerta
   * afirmava sempre a causa do canal ("não consegui ler os números de
   * WhatsApp") — e afirmar a causa errada é pior que não afirmar nenhuma:
   * manda a pessoa consertar o que não está quebrado.
   */
  | {
      ok: true;
      agent_id: string;
      /** Versão rascunho que será ensaiada e só então ativada pelo dono. */
      version_id?: string;
      publish_error?: string;
      publish_blocked_by?: "canal" | "modelo" | "chave";
      /**
       * Provedor cuja chave colada no wizard ainda não foi confirmada. Só
       * aparece quando `publish_blocked_by` é "chave" e existe chave gravada
       * esperando validação — é o que permite à tela dizer "espere um instante"
       * em vez de "cole uma chave" para quem acabou de colar a sua (#1007).
       */
      chave_em_verificacao?: string;
      provider?: string;
      /** Catálogo vazio e catálogo sem modelo que sirva pedem conselhos opostos. */
      motivo_do_modelo?: "catalogo_vazio" | "nenhum_com_ferramentas";
      /** As regras da casa não foram gravadas — o agente existe assim mesmo. */
      regras_nao_salvas?: string;
    }
  | {
      ok: false;
      error: "auth_required" | "no_active_org" | "invalid_input" | "db_error";
      details?: unknown;
    };

export async function createDefaultAgent(formData: FormData): Promise<CreateAgentResult> {
  let ctx;
  try {
    ctx = await requireOnboardingCtx();
  } catch (err) {
    if (err instanceof OnboardingError) return { ok: false, error: err.code as never };
    throw err;
  }

  const raw = {
    name: String(formData.get("name") ?? "Atendente IA").trim(),
    prompt_template: String(formData.get("prompt_template") ?? "ecommerce_friendly"),
    regras_da_casa: String(formData.get("regras_da_casa") ?? "").trim() || undefined,
  };

  let input;
  try {
    input = aiAgentDefaultSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: "invalid_input", details: err.flatten() };
    }
    throw err;
  }

  const admin = createAdminClient();

  // O ramo que o dono escreveu no primeiro passo. Falha de leitura NÃO derruba o
  // passo: o funcionário nasce sem essa frase, que é degradação honesta — o
  // contrário seria travar a contratação por causa de um adjetivo.
  let oQueFaz: string | undefined;
  let specRevisada: AgentSpecV1 | null = null;
  try {
    const { state } = await loadOnboardingState(ctx.orgId);
    oQueFaz = state.welcome?.o_que_faz;
    const configurador = (
      state as typeof state & {
        configurador_atendimento?: { session?: { status?: unknown; spec?: unknown } };
      }
    ).configurador_atendimento?.session;
    if (configurador?.status === "revisado") {
      const parsedSpec = agentSpecSchemaV1.safeParse(configurador.spec);
      if (parsedSpec.success) specRevisada = parsedSpec.data;
    }
  } catch {
    oQueFaz = undefined;
  }

  const systemPrompt = promptComSpec(
    PROMPT_BODIES[input.prompt_template](ondeTrabalha(ctx.orgName, oQueFaz)),
    specRevisada,
  );

  // O agente padrão do onboarding é UM por organização, e o banco já garante
  // isso: `ai_agents_one_default_per_org` é índice único parcial em
  // (organization_id) where is_default. Nenhum outro caminho do produto grava
  // `is_default = true` (todos os outros INSERTs em `ai_agents` gravam false),
  // então "o default desta org" É "o agente que este passo criou" — chave de
  // reaproveitamento que não depende de nenhuma escrita anterior ter dado certo.
  //
  // O código antes fazia o oposto: rebaixava o default existente e inseria
  // outro. Enquanto o passo só terminava em redirect isso nunca aparecia; agora
  // que uma falha na publicação devolve o usuário para esta tela, o segundo
  // clique criaria um "Atendente IA" órfão por clique — todos invisíveis para o
  // runtime, e nenhum deles o padrão. Repetir o passo tem que ser inofensivo.
  const { data: reaproveitado, error: reuseErr } = await admin
    .from("ai_agents")
    .update({ name: input.name, system_prompt: systemPrompt, is_active: true })
    .eq("organization_id", ctx.orgId)
    .eq("is_default", true)
    .select("id, published_version_id")
    .maybeSingle();

  if (reuseErr) {
    return { ok: false, error: "db_error", details: reuseErr.message };
  }

  let agent: AgenteDoOnboarding | null = reaproveitado;
  if (!agent) {
    const { data, error } = await admin
      .from("ai_agents")
      .insert({
        organization_id: ctx.orgId,
        name: input.name,
        system_prompt: systemPrompt,
        // `mcp_agent`, e não o `rag_bot` que o banco tem como padrão.
        //
        // O default do banco é de quando o produto só tinha o formato antigo, e o
        // onboarding nunca escrevia este campo. O resultado: o funcionário que a
        // pessoa acabava de montar abria no EDITOR LEGADO — "Temperature",
        // "Top K", "Similarity threshold" — e as capacidades que ele recebeu
        // ligadas (mexer no contato, no negócio, no funil) ficavam invisíveis
        // para o dono. Funcionavam no runtime e não tinham superfície de
        // configuração, que é o invariante 6 do Sistema Vivo quebrado.
        //
        // O que travava a virada era o editor novo exigir `credential_id`, e
        // instalação pelo kit não ter nenhuma linha em `ai_provider_credentials`.
        // Isso foi resolvido: a versão aceita `credential_id: null` (= a chave da
        // instalação) e o seletor oferece essa opção.
        kind: "mcp_agent",
        is_default: true,
        is_active: true,
        created_by: ctx.userId,
      })
      .select("id, published_version_id")
      .single();

    if (error || !data) {
      return { ok: false, error: "db_error", details: error?.message };
    }
    agent = data;
  }

  // As regras da casa valem para QUALQUER agente da organização, então vão para
  // a memória da org — o mesmo lugar que a tela de Memória edita depois — e não
  // para o prompt deste agente. Enfiá-las no prompt faria a segunda contratação
  // nascer sem elas.
  //
  // Falha aqui NÃO derruba o passo: o agente já existe e o treinamento
  // principal aconteceu. Some do caminho crítico e vira aviso.
  let regrasNaoSalvas: string | null = null;
  const memoriaDaSpec = specRevisada ? linhasDaSpec(specRevisada).join("\n") : "";
  const conteudoDaMemoria = [memoriaDaSpec, input.regras_da_casa]
    .filter((parte): parte is string => Boolean(parte?.trim()))
    .join("\n\n");
  if (conteudoDaMemoria) {
    const pub = await publicarMemoriaDaOrg(admin, ctx.orgId, ctx.userId, conteudoDaMemoria);
    if (!pub.ok) regrasNaoSalvas = pub.mensagem;
  }

  const draft = await createFirstDraftVersion(
    admin,
    ctx.orgId,
    agent,
    input.name,
    systemPrompt,
    ctx.userId,
  );

  // Estado, audit e evento saem em QUALQUER desfecho da publicação: o agente
  // existe, e o passo do onboarding é "configurar IA", não "publicar". Deixar
  // de gravá-los por causa da versão era o que fazia o wizard esquecer um passo
  // que na verdade aconteceu.
  try {
    await patchOnboardingState(ctx.orgId, {
      ai: { agent_id: agent.id, prompt_template: input.prompt_template },
      // Qualquer recriação/atualização do rascunho invalida o recibo anterior.
      teste: { respondeu: false },
    });
  } catch (err) {
    if (err instanceof OnboardingError)
      return { ok: false, error: "db_error", details: err.message };
    throw err;
  }

  await audit({
    action: "onboarding.ai_configured",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    resourceType: "ai_agent",
    resourceId: agent.id,
    metadata: {
      prompt_template: input.prompt_template,
      name: input.name,
      published: false,
      draft_created: draft.drafted,
      ...(draft.drafted ? { version_id: draft.versionId } : { draft_blocked_by: draft.reason }),
    },
  });

  // Emit a domain event for downstream listeners (Spec 01 §7 event log).
  await admin.from("event_log").insert({
    organization_id: ctx.orgId,
    event_type: "ai_agent.created",
    // NOT NULL sem default — ver `tests/unit/evento-de-publicacao-tem-dono.test.ts`.
    entity_kind: "ai_agent",
    payload: {
      agent_id: agent.id,
      source: "onboarding",
      published: false,
      ...(draft.drafted ? { version_id: draft.versionId } : {}),
    },
  });

  if (!draft.drafted && draft.reason === "failed") {
    return {
      ok: true,
      agent_id: agent.id,
      publish_error: draft.message,
      ...(regrasNaoSalvas ? { regras_nao_salvas: regrasNaoSalvas } : {}),
    };
  }

  if (!draft.drafted && draft.reason === "no_model") {
    return {
      ok: true,
      agent_id: agent.id,
      publish_blocked_by: "modelo",
      provider: draft.provider,
      motivo_do_modelo: "catalogo_vazio",
      ...(regrasNaoSalvas ? { regras_nao_salvas: regrasNaoSalvas } : {}),
    };
  }

  // Publicou o agente, mas as regras da casa não foram gravadas. O passo
  // aconteceu; o que a pessoa escreveu, não. Redirecionar calado apagaria da
  // tela o único lugar onde esse texto existia.
  if (regrasNaoSalvas) {
    return {
      ok: true,
      agent_id: agent.id,
      ...(draft.drafted ? { version_id: draft.versionId } : {}),
      regras_nao_salvas: regrasNaoSalvas,
    };
  }

  redirect("/onboarding");
}

export async function skipAi(): Promise<void> {
  const ctx = await requireOnboardingCtx();
  await patchOnboardingState(ctx.orgId, {
    ai: { agent_id: "", prompt_template: "skipped", skipped: true },
  });
  redirect("/onboarding");
}
