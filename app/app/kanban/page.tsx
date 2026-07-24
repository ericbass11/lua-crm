import { redirect } from "next/navigation";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";

import { KanbanPipelinesClient, type PipelineListItem } from "./_client";

export const dynamic = "force-dynamic";

export default async function KanbanPickerPage() {
  const user = await loadAuthUser();
  if (!user) redirect("/login");
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Você não tem nenhuma organização ativa.
      </div>
    );
  }

  const supabase = await createClient();
  const { data: pipelines } = await supabase
    .from("crm_pipelines")
    .select("id, name, slug, is_default, description")
    .eq("organization_id", activeOrg.orgId)
    .eq("is_archived", false)
    .order("position");

  const list = pipelines ?? [];

  // Contagem de leads por pipeline (gate de exclusão + label na UI).
  const counts = await Promise.all(
    list.map((p) =>
      supabase
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrg.orgId)
        .eq("pipeline_id", p.id)
        .then((r) => r.count ?? 0),
    ),
  );

  const items: PipelineListItem[] = list.map((p, i) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    is_default: p.is_default,
    description: p.description,
    lead_count: counts[i] ?? 0,
  }));

  const canManage =
    user.is_platform_admin || ROLE_RANK[activeOrg.role] >= ROLE_RANK.admin;

  return <KanbanPipelinesClient pipelines={items} canManage={canManage} />;
}
