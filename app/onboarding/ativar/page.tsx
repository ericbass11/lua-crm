import { traduzir } from "@/lib/i18n/dicionario";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OnboardingState } from "@/lib/schemas/onboarding";
import { AtivarAgenteClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function AtivarAgentePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");

  const admin = createAdminClient();
  const [{ data: agent }, { data: organization }] = await Promise.all([
    admin
      .from("ai_agents")
      .select("id,name")
      .eq("organization_id", activeOrg.orgId)
      .eq("is_default", true)
      .maybeSingle(),
    admin.from("organizations").select("onboarding_state").eq("id", activeOrg.orgId).maybeSingle(),
  ]);
  const { data: draft } = agent?.id
    ? await admin
        .from("ai_agent_versions")
        .select("id")
        .eq("organization_id", activeOrg.orgId)
        .eq("agent_id", agent.id)
        .eq("status", "draft")
        .eq("provisioning_origin", "onboarding")
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const state = (organization?.onboarding_state as OnboardingState | null) ?? {};

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">
          {traduzir("Colocar o agente no ar", user.idioma)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "O rascunho foi salvo e ensaiado, mas ainda não atende clientes. A ativação só acontece quando o dono clicar no botão abaixo.",
            user.idioma,
          )}{" "}
        </p>
      </header>
      <div className="rounded-lg border bg-background p-6">
        <p className="font-medium">
          {(agent?.name as string | undefined) ?? traduzir("Seu agente", user.idioma)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {traduzir(
            "Depois de ativar, novas mensagens recebidas no número conectado poderão ser atendidas por esta versão. Isso não dispara campanhas nem mensagens iniciadas pelo sistema.",
            user.idioma,
          )}{" "}
        </p>
      </div>
      <AtivarAgenteClient
        versionId={(draft?.id as string | undefined) ?? null}
        owner={activeOrg.role === "admin"}
        sandboxConcluido={state.teste?.respondeu === true}
      />
    </div>
  );
}
