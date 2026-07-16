/**
 * `runAgent({ runId, override? })` — heart of EPIC-13 (S-13.08).
 *
 * Sequence (Spec 10 §6):
 *   1. Load run + version + decrypt credential
 *   2. Sentinel keyword check on inbound → finalizeHandoff('keyword_match')
 *   3. Mint ephemeral api_token + setup MCP context
 *   4. Build tool set (in-process bridge to lib/mcp/tools)
 *   5. Load history sliding window
 *   6. generateText with stopWhen=[stepCountIs(maxSteps), budgetGuard]
 *   7. Detect handoff signal → finalizeHandoff('agent_invoked_tool')
 *   8. !dry_run → outbound message via sendMessageHandler (WAHA)
 *   9. finalizeRun
 *  10. revoke ephemeral token (always)
 *
 * Robustness:
 *   - Try/catch global: any throw → finalizeRun('failed', error_message=...).
 *   - Dry-run path bypasses concurrency unique guard, WAHA dispatch, outbound row.
 *   - Plaintext API keys are never logged.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, stepCountIs, type LanguageModel, type StopCondition, type ToolSet } from "ai";

import { CredentialUnavailableError, loadCredential } from "@/lib/ai/credentials";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import type { McpAuthResult } from "@/lib/mcp/auth";
import type { McpContext } from "@/lib/mcp/types";
import { computeCostCents } from "./cost";
import { finalizeRun } from "./finalize";
import { sendFinalResponse } from "./finalize";
import { finalizeHandoff } from "./handoff";
import { loadHistoryWithBudget } from "./history";
import { mintEphemeralToken, revokeEphemeralToken } from "./mcp_token";
import { pickToolsFromMcp, type RuntimeHandoffSignal } from "./tools";
import { serializeSteps } from "./serialize";
import { enrichInboundMedia } from "./media";
import { retrieveKnowledge } from "./rag";
import { resolveWahaChatId } from "@/lib/waha/send";

export interface RunAgentInput {
  runId: string;
  /** Optional override for test mode invocations from /ai/agents/:id/versions/:vid/test. */
  override?: {
    sampleMessage?: string;
    sampleContact?: { name?: string; phone?: string };
  };
}

export interface RunAgentResult {
  run_id: string;
  status: "completed" | "failed" | "aborted" | "handoff" | "skipped";
  final_text?: string;
  tool_calls?: ReturnType<typeof serializeSteps>;
  tokens_in?: number;
  tokens_out?: number;
  cost_cents?: number;
  latency_ms?: number;
  steps_count?: number;
  abort_reason?: string;
  error_code?: string;
  error_message?: string;
  would_send_to?: { session: string | null; chat_id: string | null };
}

interface RunRow {
  id: string;
  organization_id: string;
  agent_id: string;
  agent_version_id: string;
  conversation_id: string | null;
  contact_id: string | null;
  channel_session_id: string | null;
  inbound_message_id: string | null;
  status: string;
  is_dry_run: boolean;
  is_followup: boolean | null;
  followup_step: number | null;
  followup_hint: string | null;
}

interface VersionRow {
  id: string;
  organization_id: string;
  agent_id: string;
  system_prompt: string;
  provider: string;
  model: string;
  credential_id: string | null;
  tool_ids: string[];
  channel_session_id: string;
  max_steps: number;
  token_budget: number;
  cost_budget_cents: number;
  history_message_window: number;
  history_token_window: number;
  handoff_keywords: string[];
  handoff_tool_enabled: boolean;
  created_by: string | null;
}

interface AgentRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  active_kb_version_id: string | null;
}

function buildSentinelRegex(keywords: string[]): RegExp | null {
  const cleaned = keywords.filter((k) => typeof k === "string" && k.trim().length > 0);
  if (cleaned.length === 0) return null;
  const escaped = cleaned.map((k) => k.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(${escaped.join("|")})`, "i");
}

/**
 * Builds the LM directly against the provider's own API using the org's BYOK
 * credential (`ai_provider_credentials`, decrypted by `loadCredential`).
 *
 * NOT routed through Vercel AI Gateway (`createGateway`): the Gateway
 * authenticates the CALLER with a Vercel-issued `AI_GATEWAY_API_KEY`, then
 * uses Vercel's own configured provider keys — it does not accept a tenant's
 * raw Anthropic/OpenAI/Google key as a substitute credential. Passing
 * `credentialApiKey` to `createGateway({ apiKey })` always failed with
 * "Unauthenticated. Configure AI_GATEWAY_API_KEY or use a provider module.",
 * which is exactly what this does — a direct provider module per `provider`.
 */
function buildModel(provider: string, apiKey: string, modelId: string): LanguageModel {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
    default:
      throw new Error(`unsupported_provider: ${provider}`);
  }
}

function totalUsage(steps: ReadonlyArray<{ usage?: { inputTokens?: number; outputTokens?: number } }>) {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const s of steps) {
    inputTokens += s.usage?.inputTokens ?? 0;
    outputTokens += s.usage?.outputTokens ?? 0;
  }
  return { inputTokens, outputTokens };
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const admin = createAdminClient();
  const startedAt = Date.now();

  // 1) Load run row.
  const { data: runRaw } = await admin
    .from("ai_agent_runs")
    .select(
      "id, organization_id, agent_id, agent_version_id, conversation_id, contact_id, channel_session_id, inbound_message_id, status, is_dry_run, is_followup, followup_step, followup_hint",
    )
    .eq("id", input.runId)
    .maybeSingle();

  const run = runRaw as RunRow | null;
  if (!run) {
    return { run_id: input.runId, status: "failed", error_code: "run_not_found" };
  }

  // Idempotency: terminal states early-return; running is treated as in-flight elsewhere.
  if (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "aborted" ||
    run.status === "handoff"
  ) {
    return { run_id: run.id, status: "skipped" };
  }

  // 2) Promote to running. For non-dry-run rows, the partial unique index
  // (status='running' AND is_dry_run=false) protects from double-execution.
  const { error: promoteErr } = await admin
    .from("ai_agent_runs")
    .update({ status: "running" })
    .eq("id", run.id)
    .eq("organization_id", run.organization_id);
  if (promoteErr) {
    if (promoteErr.code === "23505") {
      // Conversation already has a running run.
      return { run_id: run.id, status: "skipped", abort_reason: "conv_busy" };
    }
    return failFast(run, "internal_error", `promote_failed: ${promoteErr.message}`, startedAt);
  }

  void audit({
    action: "ai_agent.run_started",
    organizationId: run.organization_id,
    resourceType: "ai_agent_run",
    resourceId: run.id,
    metadata: { agent_id: run.agent_id, agent_version_id: run.agent_version_id, is_dry_run: run.is_dry_run },
  });
  await admin.rpc("emit_event" as never, {
    p_event_type: "ai_agent.run_started",
    p_entity_kind: "ai_agent_run",
    p_entity_id: run.id,
    p_payload: { run_id: run.id, agent_id: run.agent_id, is_dry_run: run.is_dry_run },
    p_metadata: { source: "agent-runtime" },
    p_organization_id: run.organization_id,
  } as never);

  let ephemeralTokenId: string | null = null;

  try {
    // 3) Load version.
    const { data: versionRaw } = await admin
      .from("ai_agent_versions")
      .select(
        "id, organization_id, agent_id, system_prompt, provider, model, credential_id, tool_ids, channel_session_id, max_steps, token_budget, cost_budget_cents, history_message_window, history_token_window, handoff_keywords, handoff_tool_enabled, created_by",
      )
      .eq("id", run.agent_version_id)
      .eq("organization_id", run.organization_id)
      .maybeSingle();
    const version = versionRaw as VersionRow | null;
    if (!version) {
      return await failRun(run, "version_not_found", "agent version missing", startedAt);
    }

    const { data: agentRaw } = await admin
      .from("ai_agents")
      .select("id, organization_id, created_by, active_kb_version_id")
      .eq("id", run.agent_id)
      .eq("organization_id", run.organization_id)
      .maybeSingle();
    const agent = agentRaw as AgentRow | null;

    // 4) Load credential. Plaintext lives only in this scope.
    if (!version.credential_id) {
      return await failRun(run, "credential_invalid", "version has no credential", startedAt);
    }
    let credentialApiKey: string;
    try {
      const credential = await loadCredential(version.credential_id, run.organization_id);
      credentialApiKey = credential.apiKey;
    } catch (err) {
      const reason = err instanceof CredentialUnavailableError ? err.reason : "decrypt_failed";
      return await failRun(run, `credential_${reason}`, "credential unavailable", startedAt);
    }

    // 5) Resolve inbound text + dispatch context.
    let inboundBody: string | null = null;
    let chatId: string | null = null;
    let waSessionName: string | null = null;
    let contactName: string | null = null;
    let contactPhone: string | null = null;
    const conversationIdForHandoff: string | null = run.conversation_id;

    if (run.is_dry_run) {
      inboundBody = input.override?.sampleMessage?.trim() ?? null;
      chatId = input.override?.sampleContact?.phone ?? null;
    } else if (run.is_followup && run.followup_hint) {
      // Run de follow-up: não há mensagem nova do cliente — a "entrada" é a
      // instrução interna montada pelo followup-dispatcher. O histórico da
      // conversa (carregado abaixo) dá o contexto pra personalização.
      inboundBody = run.followup_hint;
    } else if (run.inbound_message_id) {
      const { data: msg } = await admin
        .from("messages")
        .select("body, type, media_url, media_mime")
        .eq("id", run.inbound_message_id)
        .eq("organization_id", run.organization_id)
        .maybeSingle();
      inboundBody = (msg?.body as string | null) ?? null;

      // Cliente mandou áudio/imagem sem texto → transcreve/descreve e grava o
      // resultado no body (aparece no inbox e não refaz em retries).
      const msgType = (msg?.type as string | null) ?? "text";
      if (!inboundBody && (msgType === "audio" || msgType === "image")) {
        const enriched = await enrichInboundMedia({
          provider: version.provider,
          apiKey: credentialApiKey,
          type: msgType,
          mediaUrl: (msg?.media_url as string | null) ?? null,
          mediaMime: (msg?.media_mime as string | null) ?? null,
        });
        if (enriched) {
          inboundBody = enriched;
          await admin
            .from("messages")
            .update({ body: enriched })
            .eq("id", run.inbound_message_id)
            .eq("organization_id", run.organization_id);
        }
      }
    }

    // For non-dry-run, prefetch session_name + contact phone (chatId).
    if (!run.is_dry_run && run.conversation_id) {
      const { data: convRaw } = await admin
        .from("conversations")
        .select(
          "id, group_chat_id, is_group, contacts:contact_id(display_name, phone_number, wa_identity), channel_sessions:channel_session_id(waha_session_name)",
        )
        .eq("id", run.conversation_id)
        .eq("organization_id", run.organization_id)
        .maybeSingle();
      const conv = convRaw as unknown as {
        id: string;
        group_chat_id: string | null;
        is_group: boolean;
        contacts: {
          display_name: string | null;
          phone_number: string | null;
          wa_identity: string | null;
        } | null;
        channel_sessions: { waha_session_name: string } | null;
      } | null;
      if (conv) {
        contactName = conv.contacts?.display_name ?? null;
        contactPhone = conv.contacts?.phone_number ?? null;
        waSessionName = conv.channel_sessions?.waha_session_name ?? null;
        chatId = resolveWahaChatId({
          isGroup: conv.is_group,
          groupChatId: conv.group_chat_id,
          phoneNumber: conv.contacts?.phone_number,
          waIdentity: conv.contacts?.wa_identity,
        });
      }
    }

    if (!inboundBody) {
      return await failRun(run, "inbound_missing", "no inbound body to process", startedAt);
    }

    // 6) Sentinel keyword check (BEFORE LLM cost).
    const sentinel = buildSentinelRegex(version.handoff_keywords ?? []);
    // Sentinela só vale pra texto do CLIENTE — a instrução interna de follow-up
    // não pode disparar handoff.
    if (!run.is_followup && sentinel && sentinel.test(inboundBody)) {
      await finalizeHandoff({
        runId: run.id,
        organizationId: run.organization_id,
        conversationId: conversationIdForHandoff,
        reason: "requested_human",
        source: "sentinel",
        latencyMs: Date.now() - startedAt,
        isDryRun: run.is_dry_run,
      });
      return {
        run_id: run.id,
        status: "handoff",
        abort_reason: "sentinel:requested_human",
        latency_ms: Date.now() - startedAt,
        tokens_in: 0,
        tokens_out: 0,
        cost_cents: 0,
        steps_count: 0,
        would_send_to: { session: waSessionName, chat_id: chatId },
      };
    }

    // 7) Mint ephemeral token + build MCP context.
    const ephemeral = await mintEphemeralToken({
      organizationId: run.organization_id,
      runId: run.id,
      versionCreatedBy: version.created_by,
      agentCreatedBy: agent?.created_by,
    });
    ephemeralTokenId = ephemeral.id;

    const auth: McpAuthResult = {
      organizationId: run.organization_id,
      role: "agent",
      actor: {
        type: "ai_agent",
        id: run.id,
        role: "agent",
        api_token_id: ephemeral.id,
      },
      apiTokenId: ephemeral.id,
      scopes: [
        "mcp:read",
        "mcp:write",
        "actor:ai_agent",
        `agent_run:${run.id}`,
        "role:agent",
      ],
    };
    const ctx: McpContext = {
      organizationId: run.organization_id,
      role: "agent",
      actor: auth.actor,
      apiTokenId: ephemeral.id,
      requestId: run.id,
      supabase: admin,
    };
    const handoffSignal: RuntimeHandoffSignal = { triggered: false };
    const tools = pickToolsFromMcp({
      supabase: admin,
      ctx,
      auth,
      toolIds: version.tool_ids ?? [],
      handoffToolEnabled: version.handoff_tool_enabled,
      handoffSignal,
    });

    // 8) Load history with budget.
    const history = run.conversation_id
      ? await loadHistoryWithBudget(admin, {
          conversationId: run.conversation_id,
          organizationId: run.organization_id,
          messageWindow: version.history_message_window,
          tokenWindow: version.history_token_window,
          excludeMessageId: run.inbound_message_id ?? undefined,
        })
      : [];

    // 9) Build LM directly against the provider (BYOK credential — see buildModel doc).
    const model = buildModel(version.provider, credentialApiKey, version.model);

    // 10) Cost/token guard. Fires BEFORE the next step is taken.
    let abortReason: string | null = null;
    const budgetGuard: StopCondition<ToolSet> = async ({ steps }) => {
      if (handoffSignal.triggered) {
        abortReason = "handoff_tool";
        return true;
      }
      const usage = totalUsage(steps as Array<{ usage?: { inputTokens?: number; outputTokens?: number } }>);
      const totalTokens = usage.inputTokens + usage.outputTokens;
      if (totalTokens > version.token_budget) {
        abortReason = "token_budget_exceeded";
        return true;
      }
      const cost = await computeCostCents({
        provider: version.provider,
        model: version.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });
      if (cost > version.cost_budget_cents) {
        abortReason = "cost_budget_exceeded";
        return true;
      }
      return false;
    };

    // 11) Run the loop.
    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: inboundBody },
    ];

    // Contexto de runtime: sem isto o modelo não conhece o conversation_id
    // (tools como crm_request_human_handoff exigem) nem quem é o cliente —
    // ele responderia pedindo "seu número/nome cadastrado" ao próprio cliente.
    const nowLabel = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date());
    const hasScheduling =
      (version.tool_ids ?? []).includes("crm_check_availability") &&
      (version.tool_ids ?? []).includes("crm_schedule_meeting");

    // RAG: se o agente tem base de conhecimento ativa, recupera trechos
    // relevantes à mensagem do cliente para a IA responder ancorada nos docs
    // da empresa (não improvisar). Degrada a "" sem KB/chave de embedding.
    let knowledgeContext = "";
    if (agent?.active_kb_version_id && inboundBody && !run.is_followup) {
      knowledgeContext = await retrieveKnowledge({
        admin,
        organizationId: run.organization_id,
        kbVersionId: agent.active_kb_version_id,
        query: inboundBody,
      });
    }

    // Funil (Fase 1 da gestão de lead pela IA): se o agente tem as tools de
    // lead, injeta as etapas com ai_criteria + o lead atual do contato, e o
    // roteiro criar→mover→preencher. Etapa sem critério fica fora (manual).
    let funnelContext = "";
    const hasFunnel =
      (version.tool_ids ?? []).includes("crm_create_lead") &&
      (version.tool_ids ?? []).includes("crm_move_lead_stage");
    if (hasFunnel && run.contact_id) {
      const { data: stageRows } = await admin
        .from("crm_stages")
        .select("id, name, ai_criteria, is_won, is_lost, pipeline_id, position, crm_pipelines:pipeline_id(id, name)")
        .eq("organization_id", run.organization_id)
        .eq("is_archived", false)
        .not("ai_criteria", "is", null)
        .order("position");
      const stages = (stageRows ?? []) as unknown as Array<{
        id: string;
        name: string;
        ai_criteria: string;
        is_won: boolean;
        is_lost: boolean;
        pipeline_id: string;
        crm_pipelines: { id: string; name: string } | Array<{ id: string; name: string }> | null;
      }>;
      if (stages.length > 0) {
        const pipelineIds = [...new Set(stages.map((s) => s.pipeline_id))];
        const { data: leadRows } = await admin
          .from("crm_leads")
          .select("id, title, stage_id, pipeline_id, status, value_cents, custom_fields")
          .eq("organization_id", run.organization_id)
          .eq("contact_id", run.contact_id)
          .in("pipeline_id", pipelineIds)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(3);
        const leads = (leadRows ?? []) as Array<{
          id: string;
          title: string;
          stage_id: string;
          pipeline_id: string;
          value_cents: number | null;
          custom_fields: Record<string, unknown> | null;
        }>;

        const byPipeline = new Map<string, { name: string; lines: string[] }>();
        for (const s of stages) {
          const p = Array.isArray(s.crm_pipelines) ? s.crm_pipelines[0] : s.crm_pipelines;
          const entry = byPipeline.get(s.pipeline_id) ?? { name: p?.name ?? "Pipeline", lines: [] };
          const marker = s.is_won ? " [GANHOU]" : s.is_lost ? " [PERDIDO]" : "";
          entry.lines.push(`  - "${s.name}"${marker} (stage_id: ${s.id}) — ${s.ai_criteria}`);
          byPipeline.set(s.pipeline_id, entry);
        }

        const funnelLines: string[] = ["FUNIL DE LEADS (etapa — quando o lead deve estar nela):"];
        for (const [pid, entry] of byPipeline) {
          funnelLines.push(`Pipeline "${entry.name}" (pipeline_id: ${pid}):`);
          funnelLines.push(...entry.lines);
        }
        if (leads.length > 0) {
          const stageName = (sid: string) => stages.find((s) => s.id === sid)?.name ?? sid;
          funnelLines.push(
            "LEAD ATUAL deste contato: " +
              leads
                .map(
                  (l) =>
                    `"${l.title}" (lead_id: ${l.id}) na etapa "${stageName(l.stage_id)}" — campos: ${JSON.stringify(l.custom_fields ?? {})}`,
                )
                .join(" | "),
          );
        } else {
          funnelLines.push("LEAD ATUAL: este contato ainda NÃO tem lead no funil.");
        }
        funnelLines.push(
          "GESTÃO DO FUNIL (faça silenciosamente, NUNCA mencione funil/etapas/CRM ao cliente):",
          "1) Sem lead e a conversa casa com o critério de alguma etapa → crm_create_lead (título curto com o interesse; contact_id acima; source 'ai_agent'). OMITA owner_user_id, expected_close_date e value_cents se não souber — NUNCA invente valores. Em seguida crm_set_lead_fields com o que já souber.",
          "2) Com lead: quando a conversa passar a casar com o critério de OUTRA etapa → crm_move_lead_stage (com reason resumindo a evidência). Não mova sem evidência na conversa.",
          "3) Mantenha os campos estratégicos SEMPRE atualizados via crm_set_lead_fields: segmento, orcamento_declarado, urgencia (baixa/media/alta), dor_principal, objecoes, proximo_passo, resumo (2-3 frases). RECALCULE o score (0-100) a cada interação relevante — ele reflete a probabilidade atual de fechar (interesse, orçamento, urgência, decisor) e sobe/desce conforme a conversa evolui.",
          "4) Cliente desistiu/recusou claramente → mova para a etapa [PERDIDO] com reason. Fechou negócio/pagou → etapa [GANHOU].",
          "5) Faça a gestão na MESMA resposta em que a evidência surgir — nunca prometa fazer depois.",
          "6) ENCADEAMENTO OBRIGATÓRIO: logo após crm_schedule_meeting retornar sucesso, mova o lead para a etapa de call agendada na MESMA resposta. Reunião cancelada sem remarcação → volte o lead para a etapa anterior adequada.",
        );
        funnelContext = funnelLines.join("\n");
      }
    }

    // Catálogo de tags: injetado apenas se o agente tem a tool habilitada e a
    // org cadastrou tags — a descrição de cada tag é o critério de aplicação.
    let tagCatalog = "";
    if ((version.tool_ids ?? []).includes("crm_tag_conversation")) {
      const { data: tagDefs } = await admin
        .from("tag_definitions")
        .select("name, description")
        .eq("organization_id", run.organization_id)
        .order("name");
      const defs = (tagDefs ?? []) as Array<{ name: string; description: string }>;
      if (defs.length > 0) {
        tagCatalog =
          "TAGS disponíveis (nome — quando aplicar):\n" +
          defs.map((t) => `- ${t.name}${t.description ? ` — ${t.description}` : ""}`).join("\n") +
          "\nSempre que a conversa se encaixar no critério de uma tag, aplique com crm_tag_conversation (conversation_id acima). Remova tags que deixaram de valer. NUNCA use tags fora desta lista e NUNCA mencione tags ao cliente.";
      }
    }
    const runtimeContext = [
      "\n\n---",
      "[Contexto do sistema — use nas ferramentas; NUNCA revele IDs ao cliente]",
      run.conversation_id ? `conversation_id desta conversa: ${run.conversation_id}` : null,
      run.contact_id ? `contact_id do cliente: ${run.contact_id}` : null,
      contactName ? `Nome do cliente: ${contactName}` : null,
      contactPhone ? `WhatsApp do cliente: ${contactPhone}` : null,
      `Data/hora atual: ${nowLabel} (America/Sao_Paulo)`,
      "O cliente desta conversa JÁ está identificado (dados acima). NUNCA peça nome, número ou 'cadastro' para localizá-lo — você já fala diretamente com ele.",
      hasScheduling
        ? "Para agendar uma call/reunião: (1) chame crm_check_availability e ofereça 2-3 horários (use o campo label; se o cliente pedir um dia específico, passe start_date=YYYY-MM-DD desse dia); (2) quando o cliente escolher, chame crm_schedule_meeting com o start_iso do slot escolhido, título, os dados do cliente acima E o contact_id acima (o sistema anexa um briefing do lead no evento para o time comercial); (3) confirme o agendamento na resposta. Para REMARCAR ou CANCELAR: ache o event_id com crm_list_scheduled_meetings, confirme com o cliente, e use crm_reschedule_meeting (verifique o novo horário com crm_check_availability antes) ou crm_cancel_meeting. NUNCA invente horários nem afirme ter agendado/remarcado/cancelado sem a ferramenta ter retornado sucesso. PROIBIDO terminar a resposta prometendo ação futura ('vou cancelar', 'vou agendar', 'deixa comigo'): se o cliente já confirmou, EXECUTE a ferramenta AGORA, na mesma resposta, e só então informe o resultado."
        : null,
      knowledgeContext || null,
      funnelContext || null,
      tagCatalog || null,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await generateText({
      model,
      system: version.system_prompt + runtimeContext,
      messages,
      tools,
      stopWhen: [stepCountIs(version.max_steps), budgetGuard],
    });

    // 12) Aggregate metrics.
    const usage = totalUsage(result.steps as Array<{ usage?: { inputTokens?: number; outputTokens?: number } }>);
    const cost = await computeCostCents({
      provider: version.provider,
      model: version.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    const latencyMs = Date.now() - startedAt;
    const trace = serializeSteps(result.steps as never);

    // 13) Handoff via tool call?
    if (handoffSignal.triggered) {
      await finalizeHandoff({
        runId: run.id,
        organizationId: run.organization_id,
        conversationId: conversationIdForHandoff,
        reason: (handoffSignal.reason as never) ?? "requested_human",
        source: "tool",
        latencyMs,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        costCents: cost,
        stepsCount: result.steps.length,
        toolCalls: trace,
        isDryRun: run.is_dry_run,
      });
      return {
        run_id: run.id,
        status: "handoff",
        abort_reason: `tool:${handoffSignal.reason ?? "requested_human"}`,
        tokens_in: usage.inputTokens,
        tokens_out: usage.outputTokens,
        cost_cents: cost,
        latency_ms: latencyMs,
        steps_count: result.steps.length,
        tool_calls: trace,
        would_send_to: { session: waSessionName, chat_id: chatId },
      };
    }

    // 14) Budget abort detected via stopWhen?
    if (abortReason) {
      await finalizeRun({
        runId: run.id,
        organizationId: run.organization_id,
        status: "aborted",
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        costCents: cost,
        latencyMs,
        stepsCount: result.steps.length,
        toolCalls: trace,
        abortReason,
        isDryRun: run.is_dry_run,
      });
      return {
        run_id: run.id,
        status: "aborted",
        abort_reason: abortReason,
        tokens_in: usage.inputTokens,
        tokens_out: usage.outputTokens,
        cost_cents: cost,
        latency_ms: latencyMs,
        steps_count: result.steps.length,
        tool_calls: trace,
        would_send_to: { session: waSessionName, chat_id: chatId },
      };
    }

    // 15) Hit max steps without natural finish?
    if (result.steps.length >= version.max_steps && result.finishReason !== "stop") {
      await finalizeRun({
        runId: run.id,
        organizationId: run.organization_id,
        status: "aborted",
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        costCents: cost,
        latencyMs,
        stepsCount: result.steps.length,
        toolCalls: trace,
        abortReason: "max_steps_reached",
        isDryRun: run.is_dry_run,
      });
      return {
        run_id: run.id,
        status: "aborted",
        abort_reason: "max_steps_reached",
        tokens_in: usage.inputTokens,
        tokens_out: usage.outputTokens,
        cost_cents: cost,
        latency_ms: latencyMs,
        steps_count: result.steps.length,
        tool_calls: trace,
        would_send_to: { session: waSessionName, chat_id: chatId },
      };
    }

    // 16) Happy path. Send WAHA reply when not dry-run.
    let outboundMessageId: string | null = null;
    const finalText = (result.text ?? "").trim();
    if (!run.is_dry_run && finalText && run.conversation_id) {
      outboundMessageId = await sendFinalResponse({
        supabase: admin,
        organizationId: run.organization_id,
        runId: run.id,
        conversationId: run.conversation_id,
        text: finalText,
        requestId: run.id,
        followupStep: run.is_followup ? (run.followup_step ?? null) : null,
      });
    }

    await finalizeRun({
      runId: run.id,
      organizationId: run.organization_id,
      status: "completed",
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      costCents: cost,
      latencyMs,
      stepsCount: result.steps.length,
      toolCalls: trace,
      outboundMessageId,
      isDryRun: run.is_dry_run,
    });

    return {
      run_id: run.id,
      status: "completed",
      final_text: finalText,
      tokens_in: usage.inputTokens,
      tokens_out: usage.outputTokens,
      cost_cents: cost,
      latency_ms: latencyMs,
      steps_count: result.steps.length,
      tool_calls: trace,
      would_send_to: { session: waSessionName, chat_id: chatId },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return await failRun(run, "runtime_error", message, startedAt);
  } finally {
    if (ephemeralTokenId) {
      await revokeEphemeralToken(ephemeralTokenId).catch(() => {
        // Token TTL=300s; lingering revoke failure is non-critical.
      });
    }
  }
}

async function failRun(
  run: RunRow,
  code: string,
  message: string,
  startedAt: number,
): Promise<RunAgentResult> {
  const latencyMs = Date.now() - startedAt;
  await finalizeRun({
    runId: run.id,
    organizationId: run.organization_id,
    status: "failed",
    errorCode: code,
    errorMessage: message,
    latencyMs,
    isDryRun: run.is_dry_run,
  });
  return {
    run_id: run.id,
    status: "failed",
    error_code: code,
    error_message: message,
    latency_ms: latencyMs,
  };
}

function failFast(
  run: RunRow,
  code: string,
  message: string,
  startedAt: number,
): RunAgentResult {
  // Used when we couldn't even promote to running — no row mutation here.
  return {
    run_id: run.id,
    status: "failed",
    error_code: code,
    error_message: message,
    latency_ms: Date.now() - startedAt,
  };
}
