/**
 * GET  /api/v1/integrations/calendar — lista integrações da org (manager+).
 *                                      Lê da view `calendar_integrations_safe`
 *                                      (nunca expõe a chave cifrada).
 * POST /api/v1/integrations/calendar — cria integração (admin). O JSON da
 *                                      Service Account entra apenas aqui, é
 *                                      cifrado AES-GCM e descartado. Validação
 *                                      de acesso à agenda roda async.
 *
 * Espelha o padrão de /api/v1/ai/credentials.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { bufToBytea, encryptKey } from "@/lib/crypto/aes_gcm";
import { parseServiceAccountJson, validateCalendarAccess } from "@/lib/google/calendar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SAFE_COLUMNS =
  "id, organization_id, provider, label, calendar_id, service_account_email, timezone, slot_minutes, business_hours, is_active, validated_at, validation_error, created_by, created_at, updated_at";

const businessHoursSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const createSchema = z.object({
  label: z.string().trim().min(1).max(80).default("Agenda principal"),
  calendar_id: z.string().trim().min(3).max(320),
  service_account_json: z.string().trim().min(50).max(20_000),
  timezone: z.string().trim().min(1).max(64).default("America/Sao_Paulo"),
  slot_minutes: z.number().int().min(10).max(240).default(30),
  business_hours: businessHoursSchema.default({ days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    return fail("forbidden_role", "Permissão insuficiente. Requer role >= manager.", 403, {
      requestId,
    });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_integrations_safe")
    .select(SAFE_COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false });

  if (error) return fail("internal_error", "Erro ao listar integrações.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return fail("forbidden_role", "Permissão insuficiente. Requer role admin.", 403, { requestId });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = createSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;

  // Com Service Account, "primary" é a agenda DO PRÓPRIO ROBÔ — eventos criados
  // nela ficam invisíveis pro usuário e o freeBusy consulta uma agenda vazia.
  // Footgun silencioso: rejeitar com instrução clara.
  if (input.calendar_id.trim().toLowerCase() === "primary") {
    return fail(
      "validation_failed",
      "Não use 'primary': essa é a agenda interna do robô, não a sua. Informe o e-mail da agenda compartilhada com a Service Account (ex.: voce@gmail.com).",
      422,
      { requestId },
    );
  }

  // Valida a estrutura do JSON antes de cifrar (e extrai o client_email
  // exposto na view — o admin precisa dele pra compartilhar a agenda).
  let saEmail: string;
  try {
    saEmail = parseServiceAccountJson(input.service_account_json).client_email;
  } catch (err) {
    return fail("validation_failed", err instanceof Error ? err.message : "Chave inválida.", 422, {
      requestId,
    });
  }

  let encrypted;
  try {
    encrypted = encryptKey(input.service_account_json);
  } catch (err) {
    console.error("[integrations.calendar] encrypt failed", err);
    return fail("internal_error", "Erro ao cifrar a chave.", 500, { requestId });
  }

  const admin = createAdminClient();
  const { data: created, error: insErr } = await admin
    .from("calendar_integrations")
    .insert({
      organization_id: activeOrg.orgId,
      provider: "google",
      label: input.label,
      calendar_id: input.calendar_id,
      service_account_email: saEmail,
      sa_key_encrypted: bufToBytea(encrypted.ciphertext),
      sa_key_iv: bufToBytea(encrypted.iv),
      sa_key_tag: bufToBytea(encrypted.tag),
      timezone: input.timezone,
      slot_minutes: input.slot_minutes,
      business_hours: input.business_hours,
      is_active: true,
      created_by: authUser.id,
    })
    .select(SAFE_COLUMNS)
    .single();

  if (insErr || !created) {
    if (insErr?.code === "23505") {
      return fail("label_already_used", "Já existe uma integração com este label.", 409, {
        requestId,
      });
    }
    return fail("internal_error", "Erro ao criar integração.", 500, { requestId });
  }

  await audit({
    action: "integration.calendar_created",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "calendar_integration",
    resourceId: (created as { id: string }).id,
    requestId,
    metadata: { provider: "google", label: input.label, calendar_id: input.calendar_id },
  });

  // Validação async fire-and-forget: testa acesso à agenda e persiste resultado.
  void runAsyncValidation(
    (created as { id: string }).id,
    activeOrg.orgId,
    input.service_account_json,
    input.calendar_id,
  );

  return ok(created, { status: 201, requestId });
}

async function runAsyncValidation(
  integrationId: string,
  organizationId: string,
  saJson: string,
  calendarId: string,
): Promise<void> {
  try {
    const sa = parseServiceAccountJson(saJson);
    const result = await validateCalendarAccess(sa, calendarId);
    const admin = createAdminClient();
    const patch = result.ok
      ? { validated_at: new Date().toISOString(), validation_error: null }
      : { validated_at: null, validation_error: result.error };
    const { error } = await admin
      .from("calendar_integrations")
      .update(patch)
      .eq("id", integrationId)
      .eq("organization_id", organizationId);
    if (error) {
      console.error("[integrations.calendar] async validation persist failed", error.message);
    }
  } catch (err) {
    console.error("[integrations.calendar] async validation crashed", err);
  }
}
