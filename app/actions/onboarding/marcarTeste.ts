"use server";

/**
 * Server Actions do passo "Ver ele atender".
 *
 * Ninguém é obrigado a testar — mas o wizard precisa saber que a tela foi
 * encarada, senão ela volta para sempre. `respondeu` guarda se o funcionário
 * chegou a responder alguma coisa: é a diferença entre "vi funcionando" e
 * "passei por aqui".
 */
import { redirect } from "next/navigation";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOnboardingCtx, patchOnboardingState } from "./_shared";

const reciboDoTesteSchema = z.object({
  runId: z.string().uuid(),
  agentId: z.string().uuid(),
  versionId: z.string().uuid(),
});

export async function marcarTesteFeito(raw: unknown): Promise<void> {
  const ctx = await requireOnboardingCtx();
  if (ctx.role !== "admin") throw new Error("owner_required");
  const input = reciboDoTesteSchema.parse(raw);
  const admin = createAdminClient();
  const { data: run, error } = await admin
    .from("ai_agent_runs")
    .select("id,completed_at")
    .eq("id", input.runId)
    .eq("organization_id", ctx.orgId)
    .eq("agent_id", input.agentId)
    .eq("agent_version_id", input.versionId)
    .eq("is_dry_run", true)
    .eq("status", "completed")
    .maybeSingle();
  if (error || !run) throw new Error("sandbox_run_not_verified");

  const testedAt = (run.completed_at as string | null) ?? new Date().toISOString();
  await patchOnboardingState(ctx.orgId, {
    teste: {
      respondeu: true,
      run_id: input.runId,
      agent_id: input.agentId,
      version_id: input.versionId,
      tested_at: testedAt,
    },
  });
  await audit({
    action: "onboarding.agente_testado",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
    metadata: {
      respondeu: true,
      run_id: input.runId,
      agent_id: input.agentId,
      version_id: input.versionId,
    },
  });
  redirect("/onboarding");
}

export async function pularTeste(): Promise<void> {
  const ctx = await requireOnboardingCtx();
  if (ctx.role !== "admin") throw new Error("owner_required");
  await patchOnboardingState(ctx.orgId, { teste: { skipped: true } });
  await audit({
    action: "onboarding.agente_teste_pulado",
    actorUserId: ctx.userId,
    organizationId: ctx.orgId,
  });
  redirect("/onboarding");
}
