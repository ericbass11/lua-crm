/**
 * DELETE /api/v1/integrations/calendar/:id — remove integração (admin).
 * POST   /api/v1/integrations/calendar/:id/revalidate vive em ./revalidate.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await params;

  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return fail("forbidden_role", "Permissão insuficiente. Requer role admin.", 403, { requestId });
  }

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
