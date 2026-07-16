/**
 * Loader da integração de agenda ativa de uma org.
 *
 * Lê `calendar_integrations` (service role — SEMPRE filtrando organization_id,
 * regra CLAUDE.md) e decifra a Service Account em memória. Usado pelas tools
 * MCP e pela validação assíncrona do cadastro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { byteaToBuffer, decryptKey } from "@/lib/crypto/aes_gcm";
import {
  parseServiceAccountJson,
  type BusinessHours,
  type CalendarConfig,
} from "./calendar";

export interface CalendarIntegrationRow {
  id: string;
  organization_id: string;
  calendar_id: string;
  service_account_email: string;
  sa_key_encrypted: unknown;
  sa_key_iv: unknown;
  sa_key_tag: unknown;
  timezone: string;
  slot_minutes: number;
  business_hours: BusinessHours;
  is_active: boolean;
  validated_at: string | null;
}

const COLUMNS =
  "id, organization_id, calendar_id, service_account_email, sa_key_encrypted, sa_key_iv, sa_key_tag, timezone, slot_minutes, business_hours, is_active, validated_at";

/**
 * Integração ativa da org com a chave decifrada, ou null se não configurada.
 * `integrationId` restringe a uma linha específica (validação pós-cadastro).
 */
export async function loadCalendarConfig(
  supabase: SupabaseClient,
  organizationId: string,
  integrationId?: string,
): Promise<{ config: CalendarConfig; integrationId: string } | null> {
  let query = supabase
    .from("calendar_integrations")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (integrationId) query = query.eq("id", integrationId);

  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as CalendarIntegrationRow;

  const rawJson = decryptKey({
    ciphertext: byteaToBuffer(row.sa_key_encrypted),
    iv: byteaToBuffer(row.sa_key_iv),
    tag: byteaToBuffer(row.sa_key_tag),
  });
  const saKey = parseServiceAccountJson(rawJson);

  return {
    integrationId: row.id,
    config: {
      saKey,
      calendarId: row.calendar_id,
      timezone: row.timezone,
      slotMinutes: row.slot_minutes,
      businessHours: row.business_hours,
    },
  };
}
