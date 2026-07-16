"use server";

import { revalidatePath } from "next/cache";

import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

export type UpdateStageCriteriaResult = { ok: true } | { ok: false; error: string };

/**
 * Atualiza o `ai_criteria` de uma etapa — o texto "quando um lead deve estar
 * nesta etapa" que o runtime injeta no agente. Vazio/whitespace = null (etapa
 * volta a ser ignorada pela IA / gestão manual). Admin apenas.
 */
export async function updateStageCriteria(
  stageId: string,
  criteria: string,
): Promise<UpdateStageCriteriaResult> {
  if (!stageId || typeof stageId !== "string") return { ok: false, error: "invalid_request" };
  if (typeof criteria !== "string" || criteria.length > 1000) {
    return { ok: false, error: "validation_failed" };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }

  const value = criteria.trim().length > 0 ? criteria.trim() : null;
  const admin = createAdminClient();
  const { error } = await admin
    .from("crm_stages")
    .update({ ai_criteria: value, updated_at: new Date().toISOString() })
    .eq("id", stageId)
    .eq("organization_id", activeOrg.orgId);
  if (error) return { ok: false, error: error.message };

  await audit({
    action: "pipeline.config_updated",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "crm_stage",
    resourceId: stageId,
    metadata: { ai_criteria_set: value !== null },
  });

  revalidatePath("/app/settings/tenant/pipelines");
  return { ok: true };
}
