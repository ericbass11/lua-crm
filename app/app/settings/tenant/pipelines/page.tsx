import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { PipelinesClient, type PipelineRow, type StageRow } from "./_client";

export const dynamic = "force-dynamic";

export default async function PipelinesSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (!user.is_platform_admin && ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("crm_pipelines")
    .select("id, name, slug, vocabulary, settings")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false)
    .order("position");

  const pipelines = (data ?? []) as PipelineRow[];

  const { data: stageData } = await supabase
    .from("crm_stages")
    .select("id, pipeline_id, name, position, is_won, is_lost, ai_criteria")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false)
    .order("position");
  const stages = (stageData ?? []) as StageRow[];

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Pipelines</h1>
        <p className="text-sm text-text-muted">
          Vocabulário, custom fields e motivos de perda por pipeline.
        </p>
      </header>
      <PipelinesClient pipelines={pipelines} stages={stages} />
    </div>
  );
}
