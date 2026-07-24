/**
 * lib/mystery/engine.ts — motor do Cliente Oculto (Fase 2).
 *
 * A IA age como CLIENTE: dispara a 1ª mensagem, responde cada resposta do alvo
 * com persona humana e conduz até a empresa OFERECER um horário — então encerra
 * educadamente SEM confirmar agendamento (decisão do produto). Métricas de tempo
 * saem dos timestamps de mystery_shopper_messages.
 *
 * Isolado de conversations/messages. Enviado pela sessão WAHA de propósito
 * 'mystery_shopper' (o ingest desvia o inbound dela pra cá, sem acionar o bot).
 */
import { generateText } from "ai";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeToE164 } from "@/lib/phone";
import { getWahaClient } from "@/lib/waha/client";
import { loadOrgLlm, type OrgLlm } from "./model";

const MESSAGE_CAP = 40; // teto anti-loop / anti-ban por campanha
// Sem auto-encerramento por tempo (decisão do produto): a campanha fica aberta
// até a IA conseguir o horário OU o operador cancelar na UI — pra medir o tempo
// real de resposta, mesmo quando a empresa demora muito.

export interface Persona {
  name: string;
  goal: string; // ex.: "agendar uma avaliação"
  backstory?: string;
  tone?: string;
}

export interface StartCampaignInput {
  organizationId: string;
  shopperSessionId: string;
  targetNumber: string;
  targetName?: string;
  recipientNumber: string;
  persona: Persona;
  city?: string;
  state?: string;
  createdBy?: string | null;
}

// DDD brasileiro → UF (pra preencher o estado a partir do número quando não
// informado). Aproximação suficiente pro CRM; o usuário pode corrigir.
const DDD_UF: Record<string, string> = {
  "11": "SP", "12": "SP", "13": "SP", "14": "SP", "15": "SP", "16": "SP", "17": "SP", "18": "SP", "19": "SP",
  "21": "RJ", "22": "RJ", "24": "RJ", "27": "ES", "28": "ES",
  "31": "MG", "32": "MG", "33": "MG", "34": "MG", "35": "MG", "37": "MG", "38": "MG",
  "41": "PR", "42": "PR", "43": "PR", "44": "PR", "45": "PR", "46": "PR",
  "47": "SC", "48": "SC", "49": "SC",
  "51": "RS", "53": "RS", "54": "RS", "55": "RS",
  "61": "DF", "62": "GO", "64": "GO", "63": "TO", "65": "MT", "66": "MT", "67": "MS",
  "68": "AC", "69": "RO", "71": "BA", "73": "BA", "74": "BA", "75": "BA", "77": "BA", "79": "SE",
  "81": "PE", "87": "PE", "82": "AL", "83": "PB", "84": "RN", "85": "CE", "88": "CE",
  "86": "PI", "89": "PI", "91": "PA", "93": "PA", "94": "PA", "92": "AM", "97": "AM",
  "95": "RR", "96": "AP", "98": "MA", "99": "MA",
};

function ufFromNumber(raw: string): string | null {
  const d = normalizeToE164(raw)?.e164.replace(/\D/g, "") ?? "";
  const ddd = d.startsWith("55") ? d.slice(2, 4) : d.slice(0, 2);
  return DDD_UF[ddd] ?? null;
}

interface ShopperSession {
  id: string;
  waha_session_name: string;
  status: string;
  purpose: string;
}

interface CampaignRow {
  id: string;
  organization_id: string;
  shopper_session_id: string;
  target_number: string;
  target_name: string | null;
  persona: Persona;
  message_count: number;
  first_contact_at: string | null;
  slot_offered_at: string | null;
  status: string;
}

type Admin = ReturnType<typeof createAdminClient>;

function chatIdForNumber(raw: string): string | null {
  return normalizeToE164(raw)?.chatId ?? null;
}

async function loadShopperSession(
  admin: Admin,
  organizationId: string,
  sessionId: string,
): Promise<ShopperSession | null> {
  const { data } = await admin
    .from("channel_sessions")
    .select("id, waha_session_name, status, purpose")
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as ShopperSession | null) ?? null;
}

interface HistoryMsg {
  direction: "shopper" | "target";
  body: string | null;
  sent_at: string;
}

async function loadHistory(admin: Admin, campaignId: string): Promise<HistoryMsg[]> {
  const { data } = await admin
    .from("mystery_shopper_messages")
    .select("direction, body, sent_at")
    .eq("campaign_id", campaignId)
    .order("sent_at", { ascending: true });
  return (data as HistoryMsg[] | null) ?? [];
}

/**
 * Envia UMA OU MAIS mensagens do oculto (picadas, como um humano digita no
 * WhatsApp) e persiste cada uma. Resolve o chatId REAL uma vez (trata o 9º
 * dígito BR) e manda cada mensagem com um pequeno intervalo (pacing humano).
 */
async function sendShopperMessages(
  admin: Admin,
  campaign: CampaignRow,
  session: ShopperSession,
  texts: string[],
): Promise<boolean> {
  const waha = getWahaClient();
  if (!waha || session.status !== "WORKING") return false;
  const digits = normalizeToE164(campaign.target_number)?.e164.replace(/\D/g, "") ?? null;
  if (!digits) return false;
  const resolved = await waha.checkExists(session.waha_session_name, digits);
  const chatId = resolved?.numberExists ? resolved.chatId : null;
  if (!chatId) return false;

  const clean = texts.map((t) => (t ?? "").trim()).filter(Boolean).slice(0, 4);
  if (clean.length === 0) return false;

  let sent = 0;
  for (let i = 0; i < clean.length; i++) {
    // Pacing humano entre mensagens (não antes da 1ª): ~1.2–2.8s + jitter.
    if (i > 0) await new Promise((r) => setTimeout(r, 1200 + Math.floor(Math.random() * 1600)));
    let externalId: string | null = null;
    try {
      const res = (await waha.sendMessage(session.waha_session_name, chatId, clean[i]!)) as {
        id?: string | { _serialized?: string };
      };
      const rawId = res?.id;
      externalId = typeof rawId === "string" ? rawId : (rawId?._serialized ?? null);
    } catch (err) {
      console.error("[mystery.engine] send failed", err instanceof Error ? err.message : String(err));
      continue;
    }
    await admin.from("mystery_shopper_messages").insert({
      organization_id: campaign.organization_id,
      campaign_id: campaign.id,
      direction: "shopper",
      body: clean[i],
      external_id: externalId,
      sent_at: new Date().toISOString(),
    });
    sent++;
  }
  if (sent > 0) {
    await admin
      .from("mystery_shopper_campaigns")
      .update({
        message_count: (campaign.message_count ?? 0) + sent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaign.id);
  }
  return sent > 0;
}

async function endCampaign(
  admin: Admin,
  campaign: CampaignRow,
  status: "completed" | "stalled" | "failed",
  outcome: string,
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, outcome, ended_at: now, updated_at: now };
  // Empresa auditada entra no funil do CRM (completed/stalled = houve auditoria).
  if (status === "completed" || status === "stalled") {
    patch.stage = "auditado";
    patch.stage_changed_at = now;
  }
  await admin
    .from("mystery_shopper_campaigns")
    .update(patch)
    .eq("id", campaign.id)
    .eq("status", "running"); // idempotente: só encerra se ainda estava rodando

  // Dispara a geração do laudo (Fase 3 consome mystery_shopper.completed).
  await admin
    .rpc("emit_event", {
      p_event_type: "mystery_shopper.completed",
      p_entity_kind: "mystery_shopper_campaign",
      p_entity_id: campaign.id,
      p_payload: { campaign_id: campaign.id, outcome },
      p_metadata: { source: "mystery_engine" },
      p_organization_id: campaign.organization_id,
    })
    .then(({ error }: { error: unknown }) => {
      if (error) console.error("[mystery.engine] emit completed failed", error);
    });
}

// ---------------------------------------------------------------------------
// Persona LLM
// ---------------------------------------------------------------------------

interface PersonaTurn {
  messages: string[];
  target_offered_slot: boolean;
  should_end: boolean;
}

function buildPersonaSystem(persona: Persona, targetName: string | null): string {
  return [
    `Você é ${persona.name}, uma pessoa real no WhatsApp querendo ${persona.goal}${targetName ? ` com "${targetName}"` : ""}.`,
    persona.backstory ? `Contexto: ${persona.backstory}` : "",
    persona.tone ? `Tom: ${persona.tone}` : "",
    "Regras de comportamento:",
    "- Fale como um humano brasileiro no WhatsApp: NÃO responda um bloco único de várias linhas. Quebre em VÁRIAS mensagens CURTAS (1 a 4), como uma pessoa digita — cada frase/ideia numa mensagem separada.",
    "- Mensagens curtas e naturais, educado, UMA pergunta por vez (a pergunta vai na última mensagem).",
    "- NUNCA revele que é IA, robô, teste ou avaliação. Você é um cliente de verdade.",
    `- Conduza a conversa até a empresa te OFERECER um horário específico (dia e hora) para ${persona.goal}.`,
    "- Quando a empresa oferecer um horário concreto, NÃO confirme o agendamento: agradeça dizendo que vai confirmar e retorna em breve — e encerre.",
    `- Se pedirem seu nome, use "${persona.name}". Invente dados plausíveis quando necessário (nunca dados sensíveis reais).`,
    "Responda SOMENTE com um JSON válido, sem markdown e sem texto fora do JSON. `messages` é um array de 1 a 4 mensagens curtas, na ordem de envio:",
    '{"messages": ["<msg curta 1>", "<msg curta 2>"], "target_offered_slot": <true|false>, "should_end": <true|false>}',
  ]
    .filter(Boolean)
    .join("\n");
}

/** Divide um texto único em mensagens curtas (fallback quando não veio array). */
function splitIntoMessages(text: string): string[] {
  const byLine = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const base = byLine.length > 1 ? byLine : text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  return (base.length ? base : [text.trim()]).slice(0, 4);
}

function parsePersonaTurn(text: string): PersonaTurn {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const json = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    const obj = JSON.parse(json) as { messages?: unknown; reply?: unknown; target_offered_slot?: unknown; should_end?: unknown };
    let messages: string[] = Array.isArray(obj.messages)
      ? obj.messages.map((m) => String(m).trim()).filter(Boolean)
      : typeof obj.reply === "string"
        ? splitIntoMessages(obj.reply)
        : [];
    if (messages.length === 0) messages = ["Certo, obrigado!"];
    return {
      messages: messages.slice(0, 4),
      target_offered_slot: obj.target_offered_slot === true,
      should_end: obj.should_end === true,
    };
  } catch {
    // Fallback: quebra o texto cru em mensagens curtas, sem encerrar.
    return { messages: splitIntoMessages(cleaned || "Certo!"), target_offered_slot: false, should_end: false };
  }
}

// ---------------------------------------------------------------------------
// Abertura (1ª mensagem) — SEMPRE única, pra não cair no filtro de spam da Meta
// ---------------------------------------------------------------------------

const OPENER_STYLES = [
  "bem direto e objetivo",
  "casual e amigável",
  "curioso, perguntando como funciona",
  "curtinho e simpático",
  "espontâneo, como quem acabou de encontrar a empresa",
  "educado e um pouco formal",
];

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

/** Fallback determinístico variado (se o LLM falhar): combina saudação × pedido × emoji. */
function fallbackOpener(persona: Persona): string {
  const g = ["Oi", "Olá", "Opa", "Oi, tudo bem?", "Boa!", "Oi, bom dia!"];
  const a = [
    `queria saber como faço pra ${persona.goal} com vocês`,
    `vocês fazem ${persona.goal}? como que agenda?`,
    `gostaria de ${persona.goal}, dá pra ver por aqui?`,
    `me ajuda? tô querendo ${persona.goal}`,
    `como funciona pra ${persona.goal} aí?`,
  ];
  const e = ["", " 🙂", " 😊", "", " 👍"];
  return `${pick(g)}, ${pick(a)}${pick(e)}`;
}

/** Gera uma 1ª mensagem ÚNICA via LLM (temperatura alta + estilo aleatório). */
async function generateOpener(
  llm: OrgLlm,
  persona: Persona,
  targetName: string | null,
): Promise<string> {
  const style = pick(OPENER_STYLES);
  try {
    const res = await generateText({
      model: llm.model,
      temperature: 1,
      system: [
        `Você é ${persona.name}, um cliente em potencial no WhatsApp${targetName ? ` da ${targetName}` : ""}.`,
        `Escreva UMA primeira mensagem, curta e natural, para iniciar o contato querendo ${persona.goal}.`,
        `Estilo desta mensagem: ${style}.`,
        "Seja espontâneo e ÚNICO — varie a saudação, a estrutura e as palavras; NUNCA pareça um template. No máximo duas frases curtas.",
        "NÃO se apresente como IA/robô/teste. Responda SOMENTE com a mensagem, sem aspas e sem explicação.",
      ].join(" "),
      messages: [{ role: "user", content: "Escreva a mensagem de abertura agora." }],
    });
    const text = (res.text ?? "").replace(/^["']+|["']+$/g, "").trim();
    return text || fallbackOpener(persona);
  } catch {
    return fallbackOpener(persona);
  }
}

// ---------------------------------------------------------------------------
// Ações públicas
// ---------------------------------------------------------------------------

export interface StartResult {
  ok: boolean;
  campaignId?: string;
  error?: string;
}

export async function startCampaign(input: StartCampaignInput): Promise<StartResult> {
  const admin = createAdminClient();
  const session = await loadShopperSession(admin, input.organizationId, input.shopperSessionId);
  if (!session) return { ok: false, error: "shopper_session_not_found" };
  if (session.purpose !== "mystery_shopper") return { ok: false, error: "session_not_mystery" };
  if (session.status !== "WORKING") return { ok: false, error: "session_not_working" };
  if (!chatIdForNumber(input.targetNumber)) return { ok: false, error: "invalid_target_number" };
  if (!normalizeToE164(input.recipientNumber)) return { ok: false, error: "invalid_recipient_number" };
  const llm = await loadOrgLlm(input.organizationId);
  if (!llm) return { ok: false, error: "no_llm_credential" };

  // Valida que o número-alvo EXISTE no WhatsApp antes de abrir a campanha
  // (senão o envio "sai" mas nunca é entregue — 9º dígito BR / número inválido).
  const waha = getWahaClient();
  if (!waha) return { ok: false, error: "waha_not_configured" };
  const targetDigits = normalizeToE164(input.targetNumber)!.e164.replace(/\D/g, "");
  const exists = await waha.checkExists(session.waha_session_name, targetDigits);
  if (!exists) return { ok: false, error: "whatsapp_check_failed" };
  if (!exists.numberExists) return { ok: false, error: "target_not_on_whatsapp" };

  const targetE164 = normalizeToE164(input.targetNumber)!.e164;
  const recipientE164 = normalizeToE164(input.recipientNumber)!.e164;

  const { data: created, error: insErr } = await admin
    .from("mystery_shopper_campaigns")
    .insert({
      organization_id: input.organizationId,
      shopper_session_id: input.shopperSessionId,
      target_number: targetE164,
      target_chat_id: exists.chatId, // JID REAL do alvo (casa o inbound; trata 9º dígito)
      target_name: input.targetName ?? null,
      persona: input.persona as unknown as Record<string, unknown>,
      recipient_number: recipientE164,
      city: input.city?.trim() || null,
      state: (input.state?.trim() || ufFromNumber(input.targetNumber) || null)?.toUpperCase() ?? null,
      status: "running",
      created_by: input.createdBy ?? null,
    })
    .select("id, organization_id, shopper_session_id, target_number, target_name, persona, message_count, first_contact_at, slot_offered_at, status")
    .single();

  if (insErr || !created) {
    // 23505 = índice parcial: já existe campanha 'running' nessa sessão.
    if ((insErr as { code?: string })?.code === "23505") {
      return { ok: false, error: "campaign_already_running" };
    }
    return { ok: false, error: insErr?.message ?? "insert_failed" };
  }

  const campaign = created as CampaignRow;
  // 1ª mensagem SEMPRE única (anti-spam Meta): gerada pela IA por campanha.
  const opener = await generateOpener(llm, input.persona, input.targetName ?? null);
  const sent = await sendShopperMessages(admin, campaign, session, splitIntoMessages(opener));
  if (!sent) {
    await endCampaign(admin, campaign, "failed", "opener_send_failed");
    return { ok: false, error: "opener_send_failed" };
  }
  return { ok: true, campaignId: campaign.id };
}

/**
 * Gera e envia a próxima fala do oculto. Idempotente por tick: só age se a
 * última mensagem for do ALVO (aguardando nossa resposta).
 */
export async function respondToCampaign(organizationId: string, campaignId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: campRaw } = await admin
    .from("mystery_shopper_campaigns")
    .select("id, organization_id, shopper_session_id, target_number, target_name, persona, message_count, first_contact_at, slot_offered_at, status")
    .eq("id", campaignId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const campaign = campRaw as CampaignRow | null;
  if (!campaign || campaign.status !== "running") return;

  if ((campaign.message_count ?? 0) >= MESSAGE_CAP) {
    await endCampaign(admin, campaign, "stalled", "message_cap_reached");
    return;
  }

  const history = await loadHistory(admin, campaignId);
  const last = history[history.length - 1];
  if (!last || last.direction !== "target") return; // nada novo pra responder

  const session = await loadShopperSession(admin, organizationId, campaign.shopper_session_id);
  if (!session) return;

  const llm = await loadOrgLlm(organizationId);
  if (!llm) {
    await endCampaign(admin, campaign, "failed", "no_llm_credential");
    return;
  }

  let turn: PersonaTurn;
  try {
    const result = await generateText({
      model: llm.model,
      system: buildPersonaSystem(campaign.persona, campaign.target_name),
      messages: history.map((m) => ({
        role: m.direction === "target" ? ("user" as const) : ("assistant" as const),
        content: m.body ?? "",
      })),
    });
    turn = parsePersonaTurn(result.text ?? "");
  } catch (err) {
    console.error("[mystery.engine] LLM failed", err instanceof Error ? err.message : String(err));
    return; // deixa o evento re-tentar (backoff do event-log-drain)
  }

  const sent = await sendShopperMessages(admin, campaign, session, turn.messages);
  if (!sent) return;

  // Encerramento robusto: o LLM às vezes produz a fala de fechamento mas ESQUECE
  // de setar o flag. Backstop determinístico: se a IA disse que vai confirmar e
  // retornar (nosso roteiro de fim), encerra mesmo sem o flag.
  const closingRx =
    /\b(vou\s+confirmar|confirmar\s+(e\s+)?(te\s+)?retorno|te\s+retorno|j[áa]\s+(te\s+)?retorno|retorno\s+(em\s+breve|logo|assim))/i;
  const saidClosing = turn.messages.some((m) => closingRx.test(m));
  const shouldEnd = turn.should_end || turn.target_offered_slot || saidClosing;

  if (shouldEnd && !campaign.slot_offered_at) {
    // Aproxima o "quando ofereceu horário" pelo timestamp da última msg do alvo.
    const lastTarget = [...history].reverse().find((m) => m.direction === "target");
    const slotAt = lastTarget?.sent_at ?? new Date().toISOString();
    await admin
      .from("mystery_shopper_campaigns")
      .update({ slot_offered_at: slotAt, updated_at: new Date().toISOString() })
      .eq("id", campaign.id);
  }
  if (shouldEnd) {
    await endCampaign(admin, campaign, "completed", "slot_offered");
  }
}

