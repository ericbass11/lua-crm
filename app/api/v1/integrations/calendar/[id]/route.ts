/**
 * DELETE /api/v1/integrations/calendar/:id — remove integração (admin).
 * POST   /api/v1/integrations/calendar/:id/revalidate vive em ./revalidate.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  // `requireRole()` e o UNICO lugar que aplica o gate de MFA (`mfaEmDivida`).
  // A comparacao manual de rank que vivia aqui decidia 403 sem passar por ele:
  // uma sessao `aal1` de admin com TOTP cadastrado atravessava esta rota sem
  // provar o segundo fator. Achado do `lint:role-rank` (upstream v1.16.1).
  const authz = await requireRole("admin", { requestId, resource: "calendar_integrations" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  const admin = createAdminClient();
  const { data: deleted, error } = await admin
    .from("calendar_integrations")
    .delete()
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .select("id, label")
    .maybeSingle();

  if (error) return fail("internal_error", "Erro ao remover integração.", 500, { requestId });
  if (!deleted) return fail("not_found", "Integração não encontrada.", 404, { requestId });

  await audit({
    action: "integration.calendar_deleted",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "calendar_integration",
    resourceId: id,
    requestId,
    metadata: { label: (deleted as { label: string }).label },
  });

  return ok({ deleted: true }, { requestId });
}
