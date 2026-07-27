import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { FollowupClient } from "./_components/FollowupClient";

export const dynamic = "force-dynamic";

export default async function FollowupSettingsPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  if (ROLE_RANK[activeOrg.role] < ROLE_RANK.admin) redirect("/403");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Follow-up automático</h1>
        <p className="text-sm text-text-muted">
          Quando o cliente para de responder, a IA envia follow-ups personalizados com base na
          conversa — em sequência, até ele responder ou a sequência acabar. Cliente respondeu, o
          ciclo zera; silenciou de novo, recomeça.
        </p>
      </header>
      <FollowupClient />
    </div>
  );
}
