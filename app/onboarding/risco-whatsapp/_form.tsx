"use client";

import { useT } from "@/hooks/i18n/useT";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { aceitarRiscoWhatsapp } from "@/app/actions/onboarding/aceitarRiscoWhatsapp";
import { Button } from "@/components/ui/button";
import { declaracaoDoRiscoWhatsapp, RISCO_WHATSAPP_VERSAO } from "@/lib/onboarding/risco-whatsapp";

export function RiscoWhatsappForm() {
  const t = useT();
  const [accepted, setAccepted] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-5 rounded-lg border bg-background p-6"
      action={(formData) => {
        startTransition(async () => {
          const result = await aceitarRiscoWhatsapp(formData);
          if (result && !result.ok) toast.error("Não foi possível registrar sua ciência.");
        });
      }}
    >
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-medium">{t("Conexão experimental durante o beta")}</p>
        <p className="mt-2 leading-relaxed">{declaracaoDoRiscoWhatsapp}</p>
      </div>

      <p className="text-sm text-muted-foreground">
        {t(
          "Esta modalidade não possui vínculo, certificação ou suporte oficial da Meta. O produto não envia campanhas ou mensagens em massa: ele responde somente a pessoas que chamarem sua empresa.",
        )}{" "}
      </p>

      <a
        className="inline-flex text-sm font-medium underline underline-offset-4"
        href="/app/connections/api-nao-oficial"
        target="_blank"
        rel="noreferrer"
      >
        {t("Ler o documento completo sobre esta conexão")}{" "}
      </a>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="accepted"
          value="true"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-1"
          required
        />
        <span>
          {t(
            "Estou ciente de que esta é uma conexão não oficial, pode desconectar e pode exigir novo QR Code. Quero continuar com o beta.",
          )}{" "}
        </span>
      </label>
      <input type="hidden" name="version" value={RISCO_WHATSAPP_VERSAO} />

      <div className="flex sm:justify-end">
        <Button className="w-full sm:w-auto" type="submit" disabled={!accepted || pending}>
          {pending ? t("Registrando...") : t("Aceitar e conectar meu número")}
        </Button>
      </div>
    </form>
  );
}
