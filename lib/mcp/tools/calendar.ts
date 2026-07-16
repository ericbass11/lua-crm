/**
 * Tools MCP de agendamento — crm_check_availability / crm_schedule_meeting.
 *
 * Backend: Google Calendar via Service Account (lib/google/calendar.ts),
 * configurado por tenant em `calendar_integrations` (Configurações →
 * Integrações). Sem integração ativa/validada, as tools retornam erro
 * legível para o agente comunicar o problema (não lançam).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  cancelEvent,
  createCalendarEvent,
  listBotEvents,
  listFreeSlots,
  rescheduleEvent,
} from "@/lib/google/calendar";
import { loadCalendarConfig } from "@/lib/google/integration";
import type { McpToolDefinition } from "../types";

const NOT_CONFIGURED =
  "Nenhuma agenda configurada para esta organização. Um admin precisa conectar o Google Calendar em Configurações → Integrações.";

const checkAvailabilityShape = {
  days_ahead: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .default(7)
    .describe("Quantos dias à frente buscar horários (default 7)."),
  max_slots: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(8)
    .describe("Máximo de horários retornados (default 8)."),
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "Data inicial da busca (YYYY-MM-DD, fuso da agenda). OBRIGATÓRIO quando o cliente pede um dia específico (ex.: 'sexta') — sem isso os dias anteriores esgotam o limite de slots.",
    ),
};

export const crmCheckAvailability: McpToolDefinition<typeof checkAvailabilityShape> = {
  name: "crm_check_availability",
  description:
    "Consulta horários LIVRES na agenda da empresa para marcar uma call/reunião. Retorna slots com start_iso (use em crm_schedule_meeting) e label humano no fuso da agenda.",
  inputSchema: checkAvailabilityShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const loaded = await loadCalendarConfig(ctx.supabase, ctx.organizationId);
    if (!loaded) return { error: NOT_CONFIGURED, slots: [] };
    try {
      const slots = await listFreeSlots(
        loaded.config,
        input.days_ahead,
        input.max_slots,
        120,
        input.start_date,
      );
      return {
        timezone: loaded.config.timezone,
        slot_minutes: loaded.config.slotMinutes,
        slots,
      };
    } catch (err) {
      return {
        error: `Falha ao consultar a agenda: ${err instanceof Error ? err.message : "erro"}`,
        slots: [],
      };
    }
  },
};

const scheduleMeetingShape = {
  start_iso: z
    .string()
    .datetime({ offset: true })
    .describe("Início do evento em ISO-8601 (use um start_iso de crm_check_availability)."),
  title: z.string().trim().min(3).max(200).describe("Título do evento na agenda."),
  duration_minutes: z
    .number()
    .int()
    .min(10)
    .max(240)
    .optional()
    .describe("Duração; default = slot_minutes da integração."),
  contact_name: z.string().trim().max(120).optional().describe("Nome do lead/cliente."),
  contact_phone: z.string().trim().max(40).optional().describe("Telefone/WhatsApp do lead."),
  contact_id: z
    .string()
    .uuid()
    .optional()
    .describe("contact_id (do contexto). Puxa os campos estratégicos do lead para o briefing pré-call."),
  notes: z.string().trim().max(2000).optional().describe("Contexto extra para o time comercial."),
};

/** Monta o briefing pré-call a partir dos campos estratégicos do lead. */
const FIELD_LABELS: Record<string, string> = {
  segmento: "Segmento",
  orcamento_declarado: "Orçamento",
  urgencia: "Urgência",
  dor_principal: "Dor principal",
  objecoes: "Objeções",
  proximo_passo: "Próximo passo",
  decisor: "É o decisor?",
  resumo: "Resumo",
  score: "Score",
};
async function buildLeadBriefing(
  supabase: SupabaseClient,
  orgId: string,
  contactId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("crm_leads")
    .select("custom_fields")
    .eq("organization_id", orgId)
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const cf = (data as { custom_fields: Record<string, unknown> | null } | null)?.custom_fields;
  if (!cf || Object.keys(cf).length === 0) return null;
  const lines = Object.entries(FIELD_LABELS)
    .filter(([k]) => cf[k] !== undefined && cf[k] !== null && String(cf[k]).trim() !== "")
    .map(([k, label]) => `• ${label}: ${cf[k]}`);
  return lines.length > 0 ? `— BRIEFING DO LEAD —\n${lines.join("\n")}` : null;
}

export const crmScheduleMeeting: McpToolDefinition<typeof scheduleMeetingShape> = {
  name: "crm_schedule_meeting",
  description:
    "Cria um evento na agenda da empresa (Google Calendar) para uma call com o lead. SEMPRE confirme o horário com o cliente antes; use um start_iso vindo de crm_check_availability.",
  inputSchema: scheduleMeetingShape,
  category: "write",
  // "agent": o runtime dos agentes roda com role agent — exigir manager
  // bloqueava a IA de agendar (o propósito da tool) e forçava handoff.
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const loaded = await loadCalendarConfig(ctx.supabase, ctx.organizationId);
    if (!loaded) return { error: NOT_CONFIGURED };

    const cfg = loaded.config;
    const startMs = Date.parse(input.start_iso);
    if (Number.isNaN(startMs)) return { error: "start_iso inválido." };
    if (startMs < Date.now()) return { error: "Não é possível agendar no passado." };

    const durationMin = input.duration_minutes ?? cfg.slotMinutes;
    const endIso = new Date(startMs + durationMin * 60_000).toISOString();

    const briefing = input.contact_id
      ? await buildLeadBriefing(ctx.supabase, ctx.organizationId, input.contact_id)
      : null;
    const descriptionParts = [
      input.contact_name ? `Cliente: ${input.contact_name}` : null,
      input.contact_phone ? `WhatsApp: ${input.contact_phone}` : null,
      input.notes ? `\n${input.notes}` : null,
      briefing ? `\n${briefing}` : null,
      "\nAgendado automaticamente pelo agente de IA do DeskcommCRM.",
    ].filter(Boolean);

    try {
      const event = await createCalendarEvent(cfg, {
        summary: input.title,
        description: descriptionParts.join("\n"),
        startIso: new Date(startMs).toISOString(),
        endIso,
        privateProps: {
          ...(input.contact_phone ? { contact_phone: input.contact_phone } : {}),
          request_id: ctx.requestId,
        },
      });
      return {
        scheduled: true,
        event_id: event.id,
        start_iso: event.start_iso,
        end_iso: event.end_iso,
        timezone: cfg.timezone,
        link: event.html_link,
      };
    } catch (err) {
      return {
        error: `Falha ao criar o evento: ${err instanceof Error ? err.message : "erro"}`,
      };
    }
  },
};

const listMeetingsShape = {
  max_results: z.number().int().min(1).max(20).optional().default(10),
};

export const crmListScheduledMeetings: McpToolDefinition<typeof listMeetingsShape> = {
  name: "crm_list_scheduled_meetings",
  description:
    "Lista as próximas reuniões AGENDADAS PELO BOT na agenda da empresa (com event_id para remarcar/cancelar). Não mostra eventos pessoais do dono da agenda.",
  inputSchema: listMeetingsShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const loaded = await loadCalendarConfig(ctx.supabase, ctx.organizationId);
    if (!loaded) return { error: NOT_CONFIGURED, meetings: [] };
    try {
      const meetings = await listBotEvents(loaded.config, input.max_results);
      return { timezone: loaded.config.timezone, meetings };
    } catch (err) {
      return {
        error: `Falha ao listar reuniões: ${err instanceof Error ? err.message : "erro"}`,
        meetings: [],
      };
    }
  },
};

const rescheduleShape = {
  event_id: z
    .string()
    .trim()
    .min(5)
    .describe("ID do evento (obtido em crm_list_scheduled_meetings ou crm_schedule_meeting)."),
  new_start_iso: z
    .string()
    .datetime({ offset: true })
    .describe("Novo início em ISO-8601 (confirme disponibilidade com crm_check_availability antes)."),
  duration_minutes: z.number().int().min(10).max(240).optional(),
};

export const crmRescheduleMeeting: McpToolDefinition<typeof rescheduleShape> = {
  name: "crm_reschedule_meeting",
  description:
    "Remarca uma reunião existente para novo horário. SEMPRE confirme o novo horário com o cliente e verifique disponibilidade (crm_check_availability) antes.",
  inputSchema: rescheduleShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const loaded = await loadCalendarConfig(ctx.supabase, ctx.organizationId);
    if (!loaded) return { error: NOT_CONFIGURED };
    const startMs = Date.parse(input.new_start_iso);
    if (Number.isNaN(startMs)) return { error: "new_start_iso inválido." };
    if (startMs < Date.now()) return { error: "Não é possível remarcar para o passado." };
    const durationMin = input.duration_minutes ?? loaded.config.slotMinutes;
    try {
      const event = await rescheduleEvent(
        loaded.config,
        input.event_id,
        new Date(startMs).toISOString(),
        new Date(startMs + durationMin * 60_000).toISOString(),
      );
      return {
        rescheduled: true,
        event_id: event.id,
        start_iso: event.start_iso,
        end_iso: event.end_iso,
        timezone: loaded.config.timezone,
      };
    } catch (err) {
      return { error: `Falha ao remarcar: ${err instanceof Error ? err.message : "erro"}` };
    }
  },
};

const cancelShape = {
  event_id: z
    .string()
    .trim()
    .min(5)
    .describe("ID do evento a cancelar (obtido em crm_list_scheduled_meetings)."),
};

export const crmCancelMeeting: McpToolDefinition<typeof cancelShape> = {
  name: "crm_cancel_meeting",
  description:
    "Cancela (remove da agenda) uma reunião agendada pelo bot. SEMPRE confirme com o cliente antes de cancelar.",
  inputSchema: cancelShape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const loaded = await loadCalendarConfig(ctx.supabase, ctx.organizationId);
    if (!loaded) return { error: NOT_CONFIGURED };
    try {
      await cancelEvent(loaded.config, input.event_id);
      return { cancelled: true, event_id: input.event_id };
    } catch (err) {
      return { error: `Falha ao cancelar: ${err instanceof Error ? err.message : "erro"}` };
    }
  },
};
