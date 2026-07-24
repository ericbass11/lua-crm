/**
 * Schemas Zod do EPIC-03 Inbox + Messaging.
 *
 * Cobre boundary de validação das rotas /api/v1/conversations e
 * /api/v1/messages. Validações compartilhadas entre rota REST e webhooks
 * (quando o payload entra na pipeline pós-verificação HMAC).
 */
import { z } from "zod";

export const conversationStatusSchema = z.enum([
  "open",
  "claimed",
  "ai_handling",
  "closed",
  "archived",
]);

export const messageDirectionSchema = z.enum(["inbound", "outbound"]);

export const messageTypeSchema = z.enum([
  "text",
  "image",
  "audio",
  "document",
  "sticker",
  "video",
  "location",
  "contact",
]);

export const messageStatusSchema = z.enum([
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
]);

export const sendMessageSchema = z
  .object({
    conversation_id: z.string().uuid(),
    type: messageTypeSchema.default("text"),
    body: z.string().min(1).max(4096).optional(),
    media_url: z.string().url().optional(),
    media_mime: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => !!d.body || !!d.media_url, {
    message: "body or media_url required",
    path: ["body"],
  });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/**
 * startConversationSchema → POST /api/v1/conversations (envio ativo).
 *
 * O operador digita um número, uma mensagem e (opcional) o nome do contato.
 * O handler normaliza o telefone (lib/phone), resolve/cria contato+conversa via
 * as RPCs de ingestão WAHA, envia a mensagem e adiciona o contato ao funil
 * padrão. `channel_session_id` é opcional — auto-seleciona o único canal
 * WORKING quando omitido; obrigatório informar quando há mais de um.
 */
export const startConversationSchema = z.object({
  phone_number: z.string().min(1, "Informe o número").max(30),
  message: z.string().min(1, "Escreva uma mensagem").max(4096),
  contact_name: z.string().max(120).optional(),
  channel_session_id: z.string().uuid().optional(),
});

export type StartConversationInput = z.infer<typeof startConversationSchema>;

export const claimConversationSchema = z.object({
  expected_assignee: z.string().uuid().nullable().optional(),
});

export type ClaimConversationInput = z.infer<typeof claimConversationSchema>;

export const updateConversationStatusSchema = z.object({
  status: conversationStatusSchema,
});

export type UpdateConversationStatusInput = z.infer<typeof updateConversationStatusSchema>;

export const listConversationsQuerySchema = z.object({
  status: conversationStatusSchema.optional(),
  assigned_to: z.union([z.string().uuid(), z.literal("me"), z.literal("unassigned")]).optional(),
  channel_session_id: z.string().uuid().optional(),
  search: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const listMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListMessagesQuery = z.infer<typeof listMessagesQuerySchema>;
