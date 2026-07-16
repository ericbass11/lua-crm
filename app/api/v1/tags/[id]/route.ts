/**
 * DELETE /api/v1/tags/:id — remove a tag do catálogo (manager+) e a limpa de
 * todas as conversas que a carregam.
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
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    return fail("forbidden_role", "Permissão insuficiente. Requer role >= manager.", 403, {
      requestId,
    });
  }

  const admin = createAdminClient();
  const { data: deleted, error } = await admin
    .from("tag_definitions")
    .delete()
    .eq("id", id)
    .eq("organization_id", activeOrg.orgId)
    .select("id, name")
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao remover tag.", 500, { requestId });
  if (!deleted) return fail("not_found", "Tag não encontrada.", 404, { requestId });

  const name = (deleted as { name: string }).name;

  // Limpa a tag das conversas que a carregam (N pequeno; contains usa o GIN).
  const { data: convs } = await admin
    .from("conversations")
    .select("id, tags")
    .eq("organization_id", activeOrg.orgId)
    .contains("tags", [name]);
  for (const c of (convs ?? []) as Array<{ id: string; tags: string[] }>) {
    await admin
      .from("conversations")
      .update({ tags: c.tags.filter((t) => t !== name), updated_at: new Date().toISOString() })
      .eq("id", c.id)
      .eq("organization_id", activeOrg.orgId);
  }

  await audit({
    action: "tag.deleted",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "tag_definition",
    resourceId: id,
    requestId,
    metadata: { name, conversations_cleaned: (convs ?? []).length },
  });

  return ok({ deleted: true, name }, { requestId });
}
