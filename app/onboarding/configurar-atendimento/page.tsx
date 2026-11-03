import { traduzir } from "@/lib/i18n/dicionario";
import { redirect } from "next/navigation";

import { loadOnboardingState } from "@/app/actions/onboarding/_shared";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { iniciarConfigurador } from "@/lib/onboarding/configurador";
import { ConfiguradorAtendimentoClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function ConfigurarAtendimentoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");

  const { state } = await loadOnboardingState(activeOrg.orgId);
  const session = state.configurador_atendimento?.session ?? iniciarConfigurador();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {traduzir("Atendente para empresas de ar-condicionado", user.idioma)}{" "}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">
          {traduzir("Conte como sua empresa atende", user.idioma)}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {traduzir(
            "Vou fazer uma pergunta por vez. No final, você revisa tudo antes de criarmos o atendente. Nada que você não disser será inventado.",
            user.idioma,
          )}{" "}
        </p>
      </header>

      <ConfiguradorAtendimentoClient session={session} />
    </div>
  );
}
