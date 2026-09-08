/**
 * DELETE /api/v1/tags/:id — remove a tag do catálogo (manager+) e a limpa de
 * todas as conversas que a carregam.
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
  const authz = await requireRole("manager", { requestId, resource: "tag_definitions" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

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
