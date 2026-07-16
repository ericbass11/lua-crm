/**
 * GET /api/v1/settings/followup — configuração de follow-up da org (manager+).
 *                                  Sem linha → devolve defaults (enabled=false).
 * PATCH /api/v1/settings/followup — upsert da configuração (admin) + audit.
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

const COLUMNS = "organization_id, enabled, timezone, send_window, steps, updated_at";

const DEFAULTS = {
  enabled: false,
  timezone: "America/Sao_Paulo",
  send_window: { days: [1, 2, 3, 4, 5, 6], start: "08:00", end: "21:00" },
  steps: [
    { delay_minutes: 15, hint: "Retome a última pergunta de forma leve e natural." },
    { delay_minutes: 120, hint: "Agregue valor: uma dica útil e específica ligada ao que foi conversado." },
    { delay_minutes: 1440, hint: "Última tentativa: cordial e breve, deixe a porta aberta sem pressionar." },
  ],
};

const putSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().trim().min(1).max(64).default("America/Sao_Paulo"),
  send_window: z.object({
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  steps: z
    .array(
      z.object({
        delay_minutes: z.number().int().min(2).max(20_160), // 2min–14 dias
        hint: z.string().trim().max(300).optional().default(""),
      }),
    )
    .min(1)
    .max(5),
});

type AuthUser = NonNullable<Awaited<ReturnType<typeof loadAuthUser>>>;
type ActiveOrg = NonNullable<Awaited<ReturnType<typeof resolveActiveOrg>>>;
type OrgCtx =
  | { ok: false; res: Response }
  | { ok: true; authUser: AuthUser; activeOrg: ActiveOrg };

async function requireOrg(minRole: "manager" | "admin"): Promise<OrgCtx> {
  const authUser = await loadAuthUser();
  if (!authUser) {
    return { ok: false, res: fail("unauthenticated", "Auth required.", 401, { requestId: randomUUID() }) };
  }
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) {
    return {
      ok: false,
      res: fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId: randomUUID() }),
    };
  }
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK[minRole]) {
    return {
      ok: false,
      res: fail("forbidden_role", `Permissão insuficiente. Requer role ${minRole}.`, 403, {
        requestId: randomUUID(),
      }),
    };
  }
  return { ok: true, authUser, activeOrg };
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await requireOrg("manager");
  if (!ctx.ok) return ctx.res;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("followup_settings")
    .select(COLUMNS)
    .eq("organization_id", ctx.activeOrg.orgId)
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao carregar configuração.", 500, { requestId });

  return ok(data ?? { organization_id: ctx.activeOrg.orgId, ...DEFAULTS }, { requestId });
}

export async function PATCH(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const ctx = await requireOrg("admin");
  if (!ctx.ok) return ctx.res;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = putSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const input = parsed.data;
  if (input.send_window.start >= input.send_window.end) {
    return fail("validation_failed", "Janela de envio: início deve ser antes do fim.", 422, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("followup_settings")
    .upsert(
      {
        organization_id: ctx.activeOrg.orgId,
        enabled: input.enabled,
        timezone: input.timezone,
        send_window: input.send_window,
        steps: input.steps,
        updated_by: ctx.authUser.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" },
    )
    .select(COLUMNS)
    .single();
  if (error || !data) {
    return fail("internal_error", "Erro ao salvar configuração.", 500, { requestId });
  }

  await audit({
    action: "settings.followup_updated",
    actorUserId: ctx.authUser.id,
    organizationId: ctx.activeOrg.orgId,
    resourceType: "followup_settings",
    resourceId: ctx.activeOrg.orgId,
    requestId,
    metadata: { enabled: input.enabled, steps: input.steps.length },
  });

  return ok(data, { requestId });
}
