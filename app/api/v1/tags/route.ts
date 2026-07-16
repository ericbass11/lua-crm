/**
 * GET  /api/v1/tags — catálogo de tags da org (qualquer membro).
 * POST /api/v1/tags — cria tag (manager+). A descrição é o critério que a IA
 *                     usa para decidir quando aplicar — incentive preenchê-la.
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

const COLUMNS = "id, organization_id, name, description, color, created_at";

const createSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(300).optional().default(""),
  color: z
    .enum(["gray", "red", "orange", "yellow", "green", "blue", "purple"])
    .optional()
    .default("gray"),
});

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tag_definitions")
    .select(COLUMNS)
    .eq("organization_id", activeOrg.orgId)
    .order("name");
  if (error) return fail("internal_error", "Erro ao listar tags.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
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

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tag_definitions")
    .insert({
      organization_id: activeOrg.orgId,
      name: parsed.data.name,
      description: parsed.data.description,
      color: parsed.data.color,
      created_by: authUser.id,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return fail("label_already_used", "Já existe uma tag com esse nome.", 409, { requestId });
    }
    return fail("internal_error", "Erro ao criar tag.", 500, { requestId });
  }

  await audit({
    action: "tag.created",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "tag_definition",
    resourceId: (data as { id: string }).id,
    requestId,
    metadata: { name: parsed.data.name },
  });

  return ok(data, { status: 201, requestId });
}
