"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

export type DeletePipelineResult =
  | { ok: true }
  | { ok: false; error: string; lead_count?: number };

/**
 * Exclui um pipeline — SOMENTE quando não há nenhum lead vinculado a ele
 * (regra do negócio). O banco também barra via FK ON DELETE RESTRICT em
 * crm_leads.pipeline_id; a checagem aqui é pra devolver mensagem amigável.
 * As etapas são removidas em cascata (crm_stages ON DELETE CASCADE). Se o
 * pipeline era o padrão e sobra outro, promove o de menor posição a padrão.
 */
export async function deletePipeline(pipelineId: string): Promise<DeletePipelineResult> {
  if (!pipelineId || typeof pipelineId !== "string") {
    return { ok: false, error: "invalid_request" };
  }

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) return { ok: false, error: "forbidden_tenant" };
  if (!authUser.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    return { ok: false, error: "forbidden_role" };
  }

  const supabase = await createClient();
  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");

  const { data: pipeline, error: readErr } = await supabase
    .from("crm_pipelines")
    .select("id, name, is_default, organization_id, position")
    .eq("id", pipelineId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!pipeline || pipeline.organization_id !== activeOrg.orgId) {
    return { ok: false, error: "not_found" };
  }

  // Regra: só exclui sem leads. Conta qualquer lead (aberto/ganho/perdido) —
  // é o que a FK RESTRICT enxerga.
  const { count, error: cntErr } = await supabase
    .from("crm_leads")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", activeOrg.orgId)
    .eq("pipeline_id", pipelineId);
  if (cntErr) return { ok: false, error: cntErr.message };
  if ((count ?? 0) > 0) {
    return { ok: false, error: "has_leads", lead_count: count ?? 0 };
  }

  const { error: delErr } = await supabase
    .from("crm_pipelines")
    .delete()
    .eq("id", pipelineId)
    .eq("organization_id", activeOrg.orgId);
  if (delErr) {
    // 23503 = FK violation (corrida: lead criado entre a contagem e o delete).
    if ((delErr as { code?: string }).code === "23503") {
      return { ok: false, error: "has_leads" };
    }
    return { ok: false, error: delErr.message };
  }

  // Preserva o invariante "1 default por org": se removemos o padrão e ainda há
  // pipelines, promove o de menor posição.
  if (pipeline.is_default) {
    const { data: next } = await supabase
      .from("crm_pipelines")
      .select("id")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_archived", false)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) {
      await supabase
        .from("crm_pipelines")
        .update({ is_default: true })
        .eq("id", (next as { id: string }).id)
        .eq("organization_id", activeOrg.orgId);
    }
  }

  await audit({
    action: "pipeline.deleted",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "pipeline",
    resourceId: pipelineId,
    requestId,
    metadata: { name: pipeline.name, was_default: pipeline.is_default },
  });

  revalidatePath("/app/kanban");
  return { ok: true };
}
