/**
 * GET   /api/v1/settings/notifications — config de notificações da org (manager+).
 * PATCH /api/v1/settings/notifications — salva webhook de handoff (admin).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const COLUMNS =
  "organization_id, handoff_webhook_url, handoff_whatsapp_number, handoff_enabled, updated_at";

const patchSchema = z.object({
  handoff_webhook_url: z
    .string()
    .trim()
    .url("URL inválida")
    .max(2048)
    .or(z.literal(""))
    .nullable()
    .optional(),
  handoff_whatsapp_number: z.string().trim().max(200).nullable().optional(),
  handoff_enabled: z.boolean().optional(),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    return fail("forbidden_role", "Requer role >= manager.", 403, { requestId });
  }
  const admin = createAdminClient();
  const { data } = await admin
    .from("notification_settings")
    .select(COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .maybeSingle();
  return ok(
    data ?? { organization_id: activeOrg.orgId, handoff_webhook_url: null, handoff_enabled: true },
    { requestId },
  );
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return fail("forbidden_role", "Requer role admin.", 403, { requestId });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = patchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const patch: Record<string, unknown> = {
    organization_id: activeOrg.orgId,
    updated_by: authUser.id,
    updated_at: new Date().toISOString(),
  };
  if (parsed.data.handoff_webhook_url !== undefined) {
    patch.handoff_webhook_url = parsed.data.handoff_webhook_url || null;
  }
  if (parsed.data.handoff_whatsapp_number !== undefined) {
    patch.handoff_whatsapp_number = parsed.data.handoff_whatsapp_number || null;
  }
  if (parsed.data.handoff_enabled !== undefined) {
    patch.handoff_enabled = parsed.data.handoff_enabled;
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("notification_settings")
    .upsert(patch, { onConflict: "organization_id" })
    .select(COLUMNS)
    .single();
  if (error || !data) return fail("internal_error", "Erro ao salvar.", 500, { requestId });

  await audit({
    action: "settings.notifications_updated",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "notification_settings",
    resourceId: activeOrg.orgId,
    requestId,
    metadata: { handoff_enabled: (data as { handoff_enabled: boolean }).handoff_enabled },
  });

  return ok(data, { requestId });
}
