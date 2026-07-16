import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { SettingsHub } from "./_components/SettingsHub";

export const dynamic = "force-dynamic";

export default async function SettingsHubPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg && !user.is_platform_admin) redirect("/app");

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          Conta, organização, IA, canais e conformidade — tudo em um só lugar.
        </p>
      </header>
      <SettingsHub />
    </div>
  );
}
