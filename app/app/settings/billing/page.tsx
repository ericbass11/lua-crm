import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { emailDeSuporte } from "@/lib/branding/saida";
import { Card } from "@/components/ui/card";
import { traduzir } from "@/lib/i18n/dicionario";
import { PLANO_MANAGED_MVP } from "@/lib/produto/plano-managed-mvp";

export const dynamic = "force-dynamic";

/**
 * A tela de dinheiro entregava o nosso contato ao cliente do revendedor, e ela
 * tem porta de 1ª classe no menu. Mesmo tratamento da tela de conta suspensa:
 * o endereço é o de quem opera a instalação (`SUPPORT_EMAIL`) e, sem ele
 * configurado, nenhum endereço aparece.
 */
export default async function BillingPage() {
  // spec 13 §4: billing é admin-only (viewer/agent/manager = none).
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  const suporte = await emailDeSuporte();
  const idioma = user.idioma;
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {traduzir("Billing", user.idioma)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {traduzir("Planos, faturas e cobrança.", idioma)}
        </p>
      </header>
      <Card className="max-w-xl space-y-5 p-6">
        <div>
          <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            {traduzir("Referência comercial do beta", user.idioma)}{" "}
          </p>
          <h2 className="mt-1 text-lg font-semibold">{PLANO_MANAGED_MVP.nome}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{PLANO_MANAGED_MVP.descricao}</p>
        </div>
        <p className="text-3xl font-semibold">
          {traduzir("R$", user.idioma)}{" "}
          {(PLANO_MANAGED_MVP.preco_mensal_centavos / 100).toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
          })}
          <span className="text-sm font-normal text-muted-foreground">
            {traduzir("/mês", user.idioma)}
          </span>
        </p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          <li>
            · {PLANO_MANAGED_MVP.numeros_whatsapp}{" "}
            {traduzir("número de WhatsApp", user.idioma)}
          </li>
          <li>
            · {PLANO_MANAGED_MVP.agentes}{" "}
            {traduzir("atendente de IA", user.idioma)}
          </li>
          <li>
            {traduzir("· Até", user.idioma)}{" "}
            {PLANO_MANAGED_MVP.respostas_ia_incluidas.toLocaleString("pt-BR")}{" "}
            {traduzir("respostas de IA por mês", user.idioma)}{" "}
          </li>
          <li>
            {traduzir(
              "· Atendimento receptivo; campanhas e disparos não fazem parte do plano",
              user.idioma,
            )}
          </li>
          <li>
            {traduzir("· Suporte", user.idioma)} {PLANO_MANAGED_MVP.suporte}
          </li>
        </ul>
        <div className="border-t pt-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">
            {traduzir("Cobrança online em preparação", user.idioma)}
          </p>
          <p className="mt-1">
            {traduzir(
              "Durante o beta, o consumo é acompanhado operacionalmente; os limites ainda não são bloqueados de forma automática. Ativação e cobrança são confirmadas de forma assíncrona.",
              user.idioma,
            )}{" "}
            {suporte ? (
              <>
                {traduzir("Para questões de pagamento, contate", idioma)}{" "}
                <a className="underline" href={`mailto:${suporte}`}>
                  {suporte}
                </a>
                .
              </>
            ) : (
              <>{traduzir("Fale com quem administra este sistema.", idioma)}</>
            )}
          </p>
        </div>
      </Card>
    </div>
  );
}
