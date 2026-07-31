import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  // spec 13 §4: billing é admin-only (viewer/agent/manager = none).
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }
  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-sm text-text-muted">Planos, faturas e cobrança.</p>
      </header>
      <Card className="max-w-xl p-6">
        <h2 className="text-sm font-semibold">Em breve — Fase 2</h2>
        <p className="mt-2 text-sm text-text-muted">
          Billing entra na Fase 2 do roadmap. Para questões de pagamento, contate{" "}
          <a className="underline" href="mailto:suporte@lua-crm.example">
            suporte@lua-crm.example
          </a>
          .
        </p>
      </Card>
    </div>
  );
}
