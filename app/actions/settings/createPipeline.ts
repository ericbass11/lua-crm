"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { createPipelineSchema, type CreatePipelineInput } from "@/lib/schemas/settings";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

export type CreatePipelineResult = { ok: true; id: string } | { ok: false; error: string };

/** slug canônico: minúsculas, só [a-z0-9_-], 2-40 chars (constraint do schema). */
function slugify(name: string): string {
  // NFD decompõe acentos (é → e + combining); o replace abaixo transforma o
  // combining mark (e qualquer não-alfanumérico) em "-", que é aparado depois.
  const base = name
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length >= 2 ? base : `pipeline-${base}`.slice(0, 40);
}

// Etapas padrão de um pipeline novo: fluxo genérico com um Ganhou (won) e um
// Perdido (lost) — win/lose endpoints e a IA dependem dessas duas âncoras.
const DEFAULT_STAGES: Array<{ name: string; slug: string; is_won?: boolean; is_lost?: boolean }> = [
  { name: "Novo", slug: "novo" },
  { name: "Em andamento", slug: "em-andamento" },
  { name: "Ganhou", slug: "ganhou", is_won: true },
  { name: "Perdido", slug: "perdido", is_lost: true },
];

export async function createPipeline(input: CreatePipelineInput): Promise<CreatePipelineResult> {
  const parsed = createPipelineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "validation_failed" };
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

  // slug único por org: pega os existentes e desambigua com sufixo -2, -3…
  const { data: existing } = await supabase
    .from("crm_pipelines")
    .select("slug, position")
    .eq("organization_id", activeOrg.orgId);
  const taken = new Set((existing ?? []).map((r) => r.slug as string));
  let slug = slugify(parsed.data.name);
  if (taken.has(slug)) {
    let n = 2;
    while (taken.has(`${slug}-${n}`.slice(0, 40))) n++;
    slug = `${slug}-${n}`.slice(0, 40);
  }
  const nextPos =
    Math.max(0, ...(existing ?? []).map((r) => Number(r.position) || 0)) + 1000;

  const { data: pipeline, error: pErr } = await supabase
    .from("crm_pipelines")
    .insert({
      organization_id: activeOrg.orgId,
      name: parsed.data.name,
      slug,
      description: parsed.data.description ?? null,
      is_default: false,
      position: nextPos,
    })
    .select("id")
    .single();
  if (pErr || !pipeline) return { ok: false, error: pErr?.message ?? "insert_failed" };

  const pipelineId = (pipeline as { id: string }).id;
  const { error: sErr } = await supabase.from("crm_stages").insert(
    DEFAULT_STAGES.map((s, i) => ({
      organization_id: activeOrg.orgId,
      pipeline_id: pipelineId,
      name: s.name,
      slug: s.slug,
      position: (i + 1) * 1000,
      is_won: s.is_won ?? false,
      is_lost: s.is_lost ?? false,
    })),
  );
  if (sErr) {
    // Rollback manual: sem etapas o board fica inútil; remove o pipeline órfão.
    await supabase.from("crm_pipelines").delete().eq("id", pipelineId);
    return { ok: false, error: sErr.message };
  }

  await audit({
    action: "pipeline.created",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "pipeline",
    resourceId: pipelineId,
    requestId,
    metadata: { name: parsed.data.name, slug, stages: DEFAULT_STAGES.length },
  });

  revalidatePath("/app/kanban");
  return { ok: true, id: pipelineId };
}
