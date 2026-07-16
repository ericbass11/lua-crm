/**
 * Cliente Google Calendar v3 via Service Account (sem SDK — REST + JWT RS256
 * assinado com node:crypto, zero dependências novas).
 *
 * Fluxo: a chave JSON da SA (client_email + private_key) vive cifrada em
 * `calendar_integrations` (AES-GCM, lib/crypto/aes_gcm.ts). Aqui ela vira um
 * JWT `RS256` trocado por access_token em oauth2.googleapis.com (cache
 * in-memory até expirar). O dono compartilha a agenda com o client_email da
 * SA ("Fazer alterações em eventos") — sem OAuth de usuário, sem callback.
 *
 * Plaintext da private_key NUNCA é logado nem persistido fora da tabela.
 */
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_BASE = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar";

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export interface BusinessHours {
  /** 0=domingo … 6=sábado (Date.getDay). */
  days: number[];
  /** "HH:MM" no fuso da integração. */
  start: string;
  end: string;
}

export interface CalendarConfig {
  saKey: ServiceAccountKey;
  calendarId: string;
  timezone: string;
  slotMinutes: number;
  businessHours: BusinessHours;
}

export interface FreeSlot {
  start_iso: string;
  end_iso: string;
  /** Rótulo humano no fuso da agenda (ex: "qua 16/07 14:00"). */
  label: string;
}

/** Valida e extrai os campos necessários de um JSON de Service Account. */
export function parseServiceAccountJson(raw: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("JSON da Service Account inválido (não é JSON).");
  }
  const obj = parsed as Record<string, unknown>;
  const email = obj["client_email"];
  const key = obj["private_key"];
  if (typeof email !== "string" || !email.includes("@")) {
    throw new Error("JSON da Service Account sem client_email.");
  }
  if (typeof key !== "string" || !key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("JSON da Service Account sem private_key válida.");
  }
  return { client_email: email, private_key: key };
}

// ── OAuth token (cache por client_email) ────────────────────────────────────
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const cached = tokenCache.get(sa.client_email);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(sa.private_key).toString("base64url");
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google OAuth falhou (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(sa.client_email, {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  });
  return json.access_token;
}

async function calFetch(
  sa: ServiceAccountKey,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken(sa);
  return fetch(`${CAL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

// ── Timezone helpers (sem dependências: Intl) ───────────────────────────────

/** Offset (ms) do fuso `tz` em relação ao UTC no instante `date`. */
function tzOffsetMs(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Instante UTC correspondente a (y-m-d hh:mm) no fuso `tz`. */
function zonedToUtc(tz: string, y: number, m: number, d: number, hh: number, mm: number): Date {
  // Chute inicial assumindo UTC, depois corrige pelo offset real (2 iterações
  // cobrem transições de horário de verão).
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  for (let i = 0; i < 2; i++) {
    guess = new Date(Date.UTC(y, m - 1, d, hh, mm) - tzOffsetMs(tz, guess));
  }
  return guess;
}

/** Partes (y,m,d,weekday) de um instante no fuso `tz`. */
function utcToZonedParts(tz: string, date: Date): { y: number; m: number; d: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    weekday: weekdayMap[parts.weekday as string] ?? 0,
  };
}

function slotLabel(tz: string, date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function parseHHMM(s: string): { h: number; m: number } {
  const [h, m] = s.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

// ── API pública ──────────────────────────────────────────────────────────────

/** Testa acesso à agenda (usado na validação assíncrona do cadastro). */
export async function validateCalendarAccess(
  sa: ServiceAccountKey,
  calendarId: string,
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  try {
    const res = await calFetch(sa, `/calendars/${encodeURIComponent(calendarId)}`);
    if (!res.ok) {
      if (res.status === 404) {
        return {
          ok: false,
          error:
            "Agenda não encontrada para a Service Account. Compartilhe a agenda com o e-mail do robô (permissão 'Fazer alterações em eventos').",
        };
      }
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Google respondeu ${res.status}: ${body.slice(0, 160)}` };
    }
    const json = (await res.json()) as { summary?: string };
    return { ok: true, summary: json.summary ?? calendarId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "erro desconhecido" };
  }
}

/** Períodos ocupados (freebusy) entre dois instantes. */
async function getBusyPeriods(
  sa: ServiceAccountKey,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<Array<{ start: number; end: number }>> {
  const res = await calFetch(sa, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: timeMinIso, timeMax: timeMaxIso, items: [{ id: calendarId }] }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`freeBusy falhou (${res.status}): ${body.slice(0, 160)}`);
  }
  const json = (await res.json()) as {
    calendars: Record<string, { busy?: Array<{ start: string; end: string }> }>;
  };
  const busy = json.calendars?.[calendarId]?.busy ?? [];
  return busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) }));
}

/**
 * Horários livres nos próximos `daysAhead` dias, respeitando janela de
 * atendimento, fuso e duração do slot. Slots começam no mínimo daqui a
 * `minNoticeMinutes` (default 120min) e o retorno é limitado a `maxSlots`.
 * `startDate` (YYYY-MM-DD no fuso da agenda) inicia a varredura num dia
 * específico — sem ele, dias próximos podem esgotar o maxSlots antes do dia
 * que o cliente pediu ("sexta") aparecer.
 */
export async function listFreeSlots(
  cfg: CalendarConfig,
  daysAhead = 7,
  maxSlots = 12,
  minNoticeMinutes = 120,
  startDate?: string,
): Promise<FreeSlot[]> {
  const now = new Date();
  let scanFrom = now;
  const dateMatch = startDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateMatch) {
    const candidate = zonedToUtc(
      cfg.timezone,
      Number(dateMatch[1]),
      Number(dateMatch[2]),
      Number(dateMatch[3]),
      0,
      0,
    );
    if (candidate.getTime() > now.getTime()) scanFrom = candidate;
  }
  const horizon = new Date(scanFrom.getTime() + daysAhead * 86_400_000);
  const busy = await getBusyPeriods(cfg.saKey, cfg.calendarId, now.toISOString(), horizon.toISOString());

  const { start, end } = cfg.businessHours;
  const st = parseHHMM(start);
  const en = parseHHMM(end);
  const slotMs = cfg.slotMinutes * 60_000;
  const earliest = now.getTime() + minNoticeMinutes * 60_000;

  const slots: FreeSlot[] = [];
  for (let day = 0; day <= daysAhead && slots.length < maxSlots; day++) {
    const probe = new Date(scanFrom.getTime() + day * 86_400_000);
    const parts = utcToZonedParts(cfg.timezone, probe);
    if (!cfg.businessHours.days.includes(parts.weekday)) continue;

    const windowStart = zonedToUtc(cfg.timezone, parts.y, parts.m, parts.d, st.h, st.m).getTime();
    const windowEnd = zonedToUtc(cfg.timezone, parts.y, parts.m, parts.d, en.h, en.m).getTime();

    for (let t = windowStart; t + slotMs <= windowEnd && slots.length < maxSlots; t += slotMs) {
      if (t < earliest) continue;
      const overlaps = busy.some((b) => t < b.end && t + slotMs > b.start);
      if (overlaps) continue;
      const startDate = new Date(t);
      slots.push({
        start_iso: startDate.toISOString(),
        end_iso: new Date(t + slotMs).toISOString(),
        label: slotLabel(cfg.timezone, startDate),
      });
    }
  }
  return slots;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  attendeeEmail?: string;
  /** Marcadores privados (invisíveis pro dono da agenda) pra reencontrar o evento. */
  privateProps?: Record<string, string>;
}

export interface CreatedEvent {
  id: string;
  html_link: string | null;
  start_iso: string;
  end_iso: string;
}

/** Cria o evento na agenda. Lança em conflito/erro do Google. */
export async function createCalendarEvent(
  cfg: CalendarConfig,
  input: CreateEventInput,
): Promise<CreatedEvent> {
  const body: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? "",
    start: { dateTime: input.startIso, timeZone: cfg.timezone },
    end: { dateTime: input.endIso, timeZone: cfg.timezone },
    extendedProperties: { private: { deskcomm: "1", ...(input.privateProps ?? {}) } },
  };
  // Service Accounts sem Domain-Wide Delegation não podem convidar attendees
  // (Google 403 forbiddenForServiceAccounts) — anexamos o e-mail na descrição.
  if (input.attendeeEmail) {
    body.description = `${body.description}\n\nParticipante: ${input.attendeeEmail}`.trim();
  }
  const res = await calFetch(
    cfg.saKey,
    `/calendars/${encodeURIComponent(cfg.calendarId)}/events`,
    { method: "POST", body: JSON.stringify(body) },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao criar evento (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    id: string;
    htmlLink?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
  };
  return {
    id: json.id,
    html_link: json.htmlLink ?? null,
    start_iso: json.start?.dateTime ?? input.startIso,
    end_iso: json.end?.dateTime ?? input.endIso,
  };
}

export interface BotEvent {
  id: string;
  summary: string;
  start_iso: string;
  end_iso: string;
  label: string;
}

/**
 * Eventos futuros criados pelo bot nesta agenda. Filtra por marcador privado
 * `deskcomm` OU criador = e-mail da Service Account (cobre eventos antigos sem
 * marcador). Nunca expõe eventos pessoais do dono da agenda.
 */
export async function listBotEvents(cfg: CalendarConfig, maxResults = 10): Promise<BotEvent[]> {
  const timeMin = encodeURIComponent(new Date().toISOString());
  const res = await calFetch(
    cfg.saKey,
    `/calendars/${encodeURIComponent(cfg.calendarId)}/events?timeMin=${timeMin}&singleEvents=true&orderBy=startTime&maxResults=50`,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao listar eventos (${res.status}): ${text.slice(0, 160)}`);
  }
  const json = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      creator?: { email?: string };
      extendedProperties?: { private?: Record<string, string> };
      start?: { dateTime?: string };
      end?: { dateTime?: string };
    }>;
  };
  return (json.items ?? [])
    .filter(
      (e) =>
        e.extendedProperties?.private?.deskcomm === "1" ||
        e.creator?.email === cfg.saKey.client_email,
    )
    .slice(0, maxResults)
    .map((e) => ({
      id: e.id,
      summary: e.summary ?? "(sem título)",
      start_iso: e.start?.dateTime ?? "",
      end_iso: e.end?.dateTime ?? "",
      label: e.start?.dateTime ? slotLabel(cfg.timezone, new Date(e.start.dateTime)) : "",
    }));
}

/** Remarca um evento (PATCH start/end). Lança em erro do Google. */
export async function rescheduleEvent(
  cfg: CalendarConfig,
  eventId: string,
  startIso: string,
  endIso: string,
): Promise<CreatedEvent> {
  const res = await calFetch(
    cfg.saKey,
    `/calendars/${encodeURIComponent(cfg.calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        start: { dateTime: startIso, timeZone: cfg.timezone },
        end: { dateTime: endIso, timeZone: cfg.timezone },
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao remarcar (${res.status}): ${text.slice(0, 160)}`);
  }
  const json = (await res.json()) as {
    id: string;
    htmlLink?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
  };
  return {
    id: json.id,
    html_link: json.htmlLink ?? null,
    start_iso: json.start?.dateTime ?? startIso,
    end_iso: json.end?.dateTime ?? endIso,
  };
}

/** Cancela (apaga) um evento. 404/410 = já não existe (idempotente). */
export async function cancelEvent(cfg: CalendarConfig, eventId: string): Promise<void> {
  const res = await calFetch(
    cfg.saKey,
    `/calendars/${encodeURIComponent(cfg.calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const text = await res.text().catch(() => "");
    throw new Error(`Falha ao cancelar (${res.status}): ${text.slice(0, 160)}`);
  }
}
