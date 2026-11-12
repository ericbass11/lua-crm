"use client";

import { useT } from "@/hooks/i18n/useT";

import { useState, useTransition } from "react";

import {
  ativarAgenteDoOnboarding,
  type AtivarAgenteResult,
} from "@/app/actions/onboarding/ativarAgente";
import { Button } from "@/components/ui/button";

interface Props {
  versionId: string | null;
  owner: boolean;
  sandboxConcluido: boolean;
}

const ERROS: Record<Exclude<AtivarAgenteResult, { ok: true }>["error"], string> = {
  owner_required: "Somente o dono administrador pode ativar este agente.",
  sandbox_required: "Veja o agente responder no ensaio antes de ativá-lo.",
  invalid_version: "O rascunho selecionado é inválido.",
  publish_failed: "Não foi possível ativar. Confira canal, modelo e credencial e tente novamente.",
};

export function AtivarAgenteClient({ versionId, owner, sandboxConcluido }: Props) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const podeAtivar = Boolean(versionId) && owner && sandboxConcluido;

  return (
    <div className="space-y-4">
      {!owner && (
        <p className="rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm" role="status">
          {t("Somente o dono administrador pode fazer a ativação final.")}{" "}
        </p>
      )}
      {!sandboxConcluido && (
        <p className="rounded-md border border-amber-300/60 bg-amber-50 p-4 text-sm" role="status">
          {t("O rascunho ainda precisa responder com sucesso no ensaio.")}{" "}
        </p>
      )}
      {!versionId && (
        <p className="rounded-md border p-4 text-sm" role="status">
          {t("Nenhum rascunho do onboarding foi encontrado.")}{" "}
        </p>
      )}
      {erro && (
        <p className="text-sm text-destructive" role="alert">
          {erro}
        </p>
      )}
      <div className="flex justify-end">
        <Button
          type="button"
          disabled={!podeAtivar || pending}
          onClick={() => {
            if (!versionId) return;
            setErro(null);
            startTransition(async () => {
              const result = await ativarAgenteDoOnboarding(versionId);
              if (!result.ok) setErro(ERROS[result.error]);
            });
          }}
        >
          {pending ? t("Ativando...") : t("Ativar agente agora")}
        </Button>
      </div>
    </div>
  );
}
