/**
 * Core handlers para /api/v1/conversations.
 *
 * Reusados pelo Route Handler REST e por MCP tools (S-13.03/04).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api/types";
import type { Actor, HandlerCtx } from "@/lib/api/handlers/types";
import { audit } from "@/lib/audit";
import { normalizeToE164 } from "@/lib/phone";
import type {
  ListConversationsQuery,
  StartConversationInput,
  UpdateConversationStatusInput,
  PatchConversationInput,
} from "@/lib/schemas";
import type { Conversation } from "@/lib/types/messaging";
import { createLeadHandler } from "@/app/api/v1/leads/_handler";
import { sendMessageHandler } from "@/app/api/v1/messages/_handler";

type SB = SupabaseClient;

const SELECT_COLS = `
  id, organization_id, contact_id, channel_session_id, channel, status,
  status_changed_at, assigned_to_user_id, assignee_kind, assigned_at, last_inbound_at,
  last_outbound_at, last_message_at, last_message_preview,
  unread_count_for_assignee, is_group, group_chat_id, tags, metadata,
  snooze_until, created_at, updated_at,
  contacts:contact_id (id, display_name, name, phone_number, is_anonymized, tags, is_blocked)
`;

interface CursorPayload {
  sort: string | null;
  id: string;
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify(p), "utf8").toString("base64url");
}
function decodeCursor(raw: string): CursorPayload | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as CursorPayload & { last_message_at?: string | null };
    if (typeof parsed.id !== "string") return null;
    // `last_message_at` é o nome legado do campo de ordenação (cursores em voo
    // durante deploy); `sort` é o genérico atual (default OU fila).
    const sort = parsed.sort ?? parsed.last_message_at ?? null;
    return { sort, id: parsed.id };
  } catch {
    return null;
  }
}

function actorAuditPayload(actor: Actor): {
  actorUserId: string | null;
  metadataActor: Record<string, unknown>;
} {
  if (actor.type === "user") {
    return { actorUserId: actor.id, metadataActor: { actor_type: "user" } };
  }
  return {
    actorUserId: null,
    metadataActor: {
      actor_type: actor.type,
      actor_id: actor.id,
      ...(actor.type === "ai_agent" && actor.api_token_id
        ? { actor_api_token_id: actor.api_token_id }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

export interface ListConversationsResult {
  conversations: Conversation[];
  cursor: string | null;
  has_more: boolean;
}

export async function listConversationsHandler(
  supabase: SB,
  ctx: HandlerCtx,
  q: ListConversationsQuery,
): Promise<ListConversationsResult> {
  // Fila (assigned_to=unassigned): ordena por TEMPO DE ESPERA — quem espera há
  // mais tempo primeiro. `last_inbound_at` = última mensagem do cliente = "há
  // quanto tempo aguarda resposta" (não `created_at`, que pode ser uma conversa
  // antiga reaberta). Demais visões: por atividade recente (last_message_at desc).
  const isQueue = q.assigned_to === "unassigned";
  const sortCol = isQueue ? "last_inbound_at" : "last_message_at";
  const asc = isQueue;

  let query = supabase
    .from("conversations")
    .select(SELECT_COLS)
    .eq("organization_id", ctx.organization_id)
    .order(sortCol, { ascending: asc, nullsFirst: false })
    .order("id", { ascending: asc })
    .limit(q.limit + 1);

  if (q.status) query = query.eq("status", q.status);
  if (q.channel_session_id) query = query.eq("channel_session_id", q.channel_session_id);
  if (q.tag) query = query.contains("tags", [q.tag]); // tags @> array[tag] (GIN)

  if (q.assigned_to === "me") {
    if (ctx.actor.type !== "user") {
      throw new ApiError(
        400,
        "invalid_request",
        undefined,
        ctx.requestId,
        '"assigned_to=me" requer ator humano.',
      );
    }
    query = query.eq("assigned_to_user_id", ctx.actor.id);
  } else if (q.assigned_to === "unassigned") {
    query = query.is("assigned_to_user_id", null);
  } else if (q.assigned_to) {
    query = query.eq("assigned_to_user_id", q.assigned_to);
  }

  if (q.search) {
    const s = q.search.trim().replace(/[%_]/g, (m) => `\\${m}`);
    query = query.ilike("last_message_preview", `%${s}%`);
  }

  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    if (!c) {
      throw new ApiError(400, "invalid_cursor", undefined, ctx.requestId, "Cursor inválido.");
    }
    const op = asc ? "gt" : "lt";
    if (c.sort) {
      query = query.or(
        `${sortCol}.${op}.${c.sort},and(${sortCol}.eq.${c.sort},id.${op}.${c.id})`,
      );
    } else {
      // Página já na região de sort NULL (nulls last): pagina só por id.
      query = query.is(sortCol, null);
      query = asc ? query.gt("id", c.id) : query.lt("id", c.id);
    }
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  }

  const rows = (data ?? []) as unknown as Conversation[];
  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  const cursor =
    hasMore && last
      ? encodeCursor({ sort: (last[sortCol] as string | null) ?? null, id: last.id })
      : null;

  return { conversations: page, cursor, has_more: hasMore };
}

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

export async function getConversationHandler(
  supabase: SB,
  ctx: HandlerCtx,
  conversationId: string,
): Promise<Conversation> {
  const { data, error } = await supabase
    .from("conversations")
    .select(SELECT_COLS)
    .eq("id", conversationId)
    .eq("organization_id", ctx.organization_id)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  }
  if (!data) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Conversa não encontrada.");
  }
  return data as unknown as Conversation;
}

// ---------------------------------------------------------------------------
// update status (claim/close/release)
// ---------------------------------------------------------------------------

export async function patchConversationHandler(
  supabase: SB,
  ctx: HandlerCtx,
  conversationId: string,
  input: PatchConversationInput,
): Promise<Conversation> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {};

  if (input.status !== undefined) {
    update.status = input.status;
    update.status_changed_at = now;
    // Atalho: status='claimed' assume o atendimento se ator for usuário humano.
    if (input.status === "claimed" && ctx.actor.type === "user") {
      update.assigned_to_user_id = ctx.actor.id;
      update.assigned_at = now;
    }
  }
  if (input.tags !== undefined) {
    update.tags = input.tags;
  }

  const { data, error } = await supabase
    .from("conversations")
    .update(update)
    .eq("id", conversationId)
    .eq("organization_id", ctx.organization_id)
    .select(SELECT_COLS)
    .maybeSingle();

  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  }
  if (!data) {
    throw new ApiError(404, "not_found", undefined, ctx.requestId, "Conversa não encontrada.");
  }

  const conv = data as unknown as Conversation;
  const a = actorAuditPayload(ctx.actor);

  if (input.status !== undefined) {
    const action =
      input.status === "claimed"
        ? "conversation.claimed"
        : input.status === "closed"
          ? "conversation.closed"
          : "conversation.released";
    await audit({
      action,
      actorUserId: a.actorUserId,
      organizationId: conv.organization_id,
      resourceType: "conversation",
      resourceId: conv.id,
      requestId: ctx.requestId,
      metadata: { ...a.metadataActor, status: input.status },
    });
  }
  if (input.tags !== undefined) {
    await audit({
      action: "conversation.tags_changed",
      actorUserId: a.actorUserId,
      organizationId: conv.organization_id,
      resourceType: "conversation",
      resourceId: conv.id,
      requestId: ctx.requestId,
      metadata: { ...a.metadataActor, tags: input.tags },
    });
  }

  return conv;
}

// ---------------------------------------------------------------------------
// start (envio ativo) — cria/resolve contato+conversa, envia 1ª mensagem e
// adiciona o contato ao funil padrão. Ver lib/schemas startConversationSchema.
// ---------------------------------------------------------------------------

export interface StartConversationResult {
  conversation_id: string;
  contact_id: string;
  message_id: string;
  message_status: string;
  lead_created: boolean;
  lead_id: string | null;
}

/**
 * Resolve o canal WhatsApp que fará o envio.
 *  - `requestedId` informado → valida que pertence à org e está WORKING.
 *  - omitido → auto-seleciona quando há exatamente um WORKING; erra se 0 ou >1.
 */
async function resolveWorkingChannel(
  supabase: SB,
  ctx: HandlerCtx,
  requestedId: string | undefined,
): Promise<string> {
  const { data, error } = await supabase
    .from("channel_sessions")
    .select("id, status")
    .eq("organization_id", ctx.organization_id);
  if (error) {
    throw new ApiError(500, "internal_error", undefined, ctx.requestId, error.message);
  }
  const sessions = (data ?? []) as Array<{ id: string; status: string }>;
  const working = sessions.filter((s) => s.status === "WORKING");

  if (requestedId) {
    const found = sessions.find((s) => s.id === requestedId);
    if (!found) {
      throw new ApiError(404, "channel_not_found", undefined, ctx.requestId, "Canal não encontrado.");
    }
    if (found.status !== "WORKING") {
      throw new ApiError(
        422,
        "channel_not_working",
        undefined,
        ctx.requestId,
        "O canal selecionado não está conectado.",
      );
    }
    return found.id;
  }

  if (working.length === 0) {
    throw new ApiError(
      422,
      "no_working_channel",
      undefined,
      ctx.requestId,
      "Nenhum número de WhatsApp conectado. Conecte um canal antes de enviar.",
    );
  }
  if (working.length > 1) {
    throw new ApiError(
      422,
      "channel_required",
      undefined,
      ctx.requestId,
      "Há mais de um número conectado — escolha por qual canal enviar.",
    );
  }
  return working[0]!.id;
}

/**
 * Cria (ou reusa, dedup atômico) o lead do contato no funil padrão, 1ª etapa.
 * Best-effort: qualquer falha aqui é registrada mas NÃO derruba o envio da
 * mensagem — o retorno indica se um lead foi de fato criado.
 */
async function addToDefaultPipeline(
  supabase: SB,
  ctx: HandlerCtx,
  contactId: string,
  title: string,
): Promise<{ lead_created: boolean; lead_id: string | null }> {
  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("is_default", true)
    .eq("is_archived", false)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!pipeline) return { lead_created: false, lead_id: null };
  const pipelineId = (pipeline as { id: string }).id;

  const { data: stage } = await supabase
    .from("crm_stages")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stage) return { lead_created: false, lead_id: null };
  const stageId = (stage as { id: string }).id;

  // Dedup: contato já tem lead aberto neste funil? Então reusa (não duplica).
  const { data: existing } = await supabase
    .from("crm_leads")
    .select("id")
    .eq("organization_id", ctx.organization_id)
    .eq("pipeline_id", pipelineId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (existing) return { lead_created: false, lead_id: (existing as { id: string }).id };

  const lead = await createLeadHandler(supabase, ctx, {
    pipeline_id: pipelineId,
    stage_id: stageId,
    title: title.slice(0, 200),
    contact_id: contactId,
    currency: "BRL",
    tags: [],
    source: "whatsapp_active",
  });
  return { lead_created: true, lead_id: (lead as { id: string }).id };
}

export async function startConversationHandler(
  supabase: SB,
  admin: SB,
  ctx: HandlerCtx,
  input: StartConversationInput,
): Promise<StartConversationResult> {
  const normalized = normalizeToE164(input.phone_number);
  if (!normalized) {
    throw new ApiError(
      422,
      "invalid_phone_number",
      undefined,
      ctx.requestId,
      "Número de telefone inválido.",
    );
  }

  const channelSessionId = await resolveWorkingChannel(supabase, ctx, input.channel_session_id);

  // Upserts atômicos (security definer → service_role): mesma semântica de
  // dedup do ingest de inbound, então número existente reusa contato/conversa.
  const { data: contactId, error: cErr } = await admin.rpc("fn_upsert_wa_contact" as never, {
    p_org: ctx.organization_id,
    p_kind: "phone",
    p_phone: normalized.e164,
    p_lid: null,
    p_chat_id: normalized.chatId,
    p_notify: input.contact_name?.trim() || null,
  } as never);
  if (cErr || !contactId) {
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      cErr?.message ?? "contact_upsert_failed",
    );
  }

  const { data: conversationId, error: convErr } = await admin.rpc(
    "fn_upsert_wa_conversation" as never,
    {
      p_org: ctx.organization_id,
      p_contact: contactId as unknown as string,
      p_session: channelSessionId,
    } as never,
  );
  if (convErr || !conversationId) {
    throw new ApiError(
      500,
      "internal_error",
      undefined,
      ctx.requestId,
      convErr?.message ?? "conversation_upsert_failed",
    );
  }

  // Envia a 1ª mensagem pelo caminho de produção (grava row + dispara WAHA +
  // ack). Client RLS do usuário — a conversa recém-criada pertence à org ativa.
  const message = await sendMessageHandler(supabase, ctx, {
    conversation_id: conversationId as unknown as string,
    type: "text",
    body: input.message,
  });

  // Adiciona ao funil padrão (best-effort — não falha o envio já concluído).
  let lead = { lead_created: false, lead_id: null as string | null };
  try {
    lead = await addToDefaultPipeline(
      supabase,
      ctx,
      contactId as unknown as string,
      input.contact_name?.trim() || normalized.e164,
    );
  } catch (err) {
    console.error(
      "[conversations.start] addToDefaultPipeline failed",
      err instanceof Error ? err.message : String(err),
    );
  }

  return {
    conversation_id: conversationId as unknown as string,
    contact_id: contactId as unknown as string,
    message_id: message.id,
    message_status: message.status,
    lead_created: lead.lead_created,
    lead_id: lead.lead_id,
  };
}
