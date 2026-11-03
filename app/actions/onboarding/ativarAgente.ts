"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOnboardingState, patchOnboardingState, requireOnboardingCtx } from "./_shared";

const versaoSchema = z.string().uuid();

export type AtivarAgenteResult =
  | {
      ok: false;
      error: "owner_required" | "sandbox_required" | "invalid_version" | "publish_failed";
    }
  | { ok: true };

/**
 * Coloca o agente do onboarding no ar somente depois do ensaio e de um clique
 * humano explícito. O rascunho continua inerte até esta action ser chamada.
 */
export async function ativarAgenteDoOnboarding(versaoId: string): Promise<AtivarAgenteResult> {
  const ctx = await requireOnboardingCtx();
  if (ctx.role !== "admin") return { ok: false, error: "owner_required" };

  const parsed = versaoSchema.safeParse(versaoId);
  if (!parsed.success) return { ok: false, error: "invalid_version" };

  const { state } = await loadOnboardingState(ctx.orgId);
  const agentId = state.ai?.agent_id;
  if (!agentId) return { ok: false, error: "publish_failed" };
  if (
    state.teste?.respondeu !== true ||
    state.teste.agent_id !== agentId ||
    state.teste.version_id !== parsed.data ||
    !state.teste.run_id
  ) {
    return { ok: false, error: "sandbox_required" };
  }

  const admin = createAdminClient();
  const published = await publishAgentVersion(admin, {
    orgId: ctx.orgId,
    agentId,
    versionId: parsed.data,
    expectedProvenance: "onboarding",
  });
  if (!published.ok) return { ok: false, error: "publish_failed" };

  // A publicação já foi efetivada atomicamente. O evento é projeção secundária
  // e não pode fazer a UI dizer "falhou" depois de o agente já estar no ar.
  const { error: eventError } = await admin.from("event_log").insert({
    organization_id: ctx.orgId,
    event_type: "ai_agent.published",
    entity_kind: "ai_agent",
    payload: {
      agent_id: published.agent_id,
      version_id: published.version_id,
      previous_version_id: published.previous_version_id,
      published_at: published.published_at,
      source: "onboarding_owner_activation",
    },
  });
  if (eventError) {
    console.error("[onboarding] agente publicado sem projeção no event_log", {
      organization_id: ctx.orgId,
      agent_id: published.agent_id,
      version_id: published.version_id,
      error: eventError.message,
    });
  }
  await audit({
    action: "ai_agent.published",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    resourceType: "ai_agent",
    resourceId: agentId,
    metadata: {
      version_id: published.version_id,
      previous_version_id: published.previous_version_id,
      source: "onboarding_owner_activation",
    },
  });

  await patchOnboardingState(ctx.orgId, {
    ativacao: {
      agent_id: published.agent_id,
      version_id: published.version_id,
      activated_at: published.published_at,
    },
  });

  redirect("/onboarding");
}
