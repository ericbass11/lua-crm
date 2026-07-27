import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { TagsClient } from "./_components/TagsClient";

export const dynamic = "force-dynamic";

export default async function TagsSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) redirect("/403");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Tags de conversa</h1>
        <p className="text-sm text-text-muted">
          Cadastre as tags que a IA pode aplicar nas conversas. A <strong>descrição</strong> é o
          critério que a IA usa para decidir — seja específico (ex.: &quot;cliente pediu preço ou
          orçamento&quot;).
        </p>
      </header>
      <TagsClient />
    </div>
  );
}
