import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { InviteForm } from "./_components/InviteForm";

export const dynamic = "force-dynamic";

export default async function TeamInvitePage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) {
    redirect("/403");
  }

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-text">Convidar membros</h1>
        <p className="text-sm text-text-subtle">
          Cole até 20 emails (um por linha) e escolha a role compartilhada.
        </p>
      </header>
      <InviteForm />
    </div>
  );
}
