import { traduzir } from "@/lib/i18n/dicionario";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { RiscoWhatsappForm } from "./_form";

export default async function RiscoWhatsappPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/login");
  if (activeOrg.role !== "admin") redirect("/403");

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">
          {traduzir("Antes de conectar o WhatsApp", user.idioma)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {traduzir(
            "Transparência primeiro: veja como a conexão do beta funciona e quais limites ela possui.",
            user.idioma,
          )}{" "}
        </p>
      </header>
      <RiscoWhatsappForm />
    </div>
  );
}
