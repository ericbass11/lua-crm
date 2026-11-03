"use client";

import { useT } from "@/hooks/i18n/useT";

import { useTransition } from "react";
import { toast } from "sonner";

import {
  aprovarConfigurador,
  responderConfigurador,
  revisarConfigurador,
} from "@/app/actions/onboarding/configurarAtendimento";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  PERGUNTAS_CONFIGURADOR,
  avaliarProntidao,
  gerarRoteiroDeTestes,
  type SessaoConfigurador,
} from "@/lib/onboarding/configurador";

interface Props {
  session: SessaoConfigurador;
}

const ROTULOS = new Map(PERGUNTAS_CONFIGURADOR.map((pergunta) => [pergunta.id, pergunta.texto]));

export function ConfiguradorAtendimentoClient({ session }: Props) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const prontidao = avaliarProntidao(session.spec);
  const roteiro = prontidao.ready ? gerarRoteiroDeTestes(session.spec) : [];

  function executar(action: () => Promise<{ ok: boolean; error?: string } | void>) {
    startTransition(async () => {
      const result = await action();
      if (result && !result.ok)
        toast.error("Não consegui salvar. Revise a resposta e tente de novo.");
    });
  }

  return (
    <div className="space-y-5">
      {Object.entries(session.respostas).length > 0 && (
        <section className="space-y-3 rounded-lg border bg-muted/20 p-4">
          <h3 className="text-sm font-medium">{t("O que você já me contou")}</h3>
          <div className="space-y-3">
            {Object.entries(session.respostas).map(([id, resposta]) => (
              <details key={id} className="rounded-md border bg-background p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {ROTULOS.get(id as never) ?? id}
                </summary>
                <form
                  className="mt-3 space-y-2"
                  action={(formData) => executar(() => revisarConfigurador(formData))}
                >
                  <input type="hidden" name="pergunta_id" value={id} />
                  <Textarea
                    name="resposta"
                    defaultValue={resposta}
                    rows={3}
                    maxLength={3000}
                    required
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={pending}>
                    {t("Salvar correção")}{" "}
                  </Button>
                </form>
              </details>
            ))}
          </div>
        </section>
      )}

      {session.status === "coletando" && session.pergunta_atual && (
        <form
          className="space-y-4 rounded-lg border bg-background p-6"
          action={(formData) => executar(() => responderConfigurador(formData))}
        >
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("Pergunta")} {Object.keys(session.respostas).length + 1}{" "}
              {t("de")} {PERGUNTAS_CONFIGURADOR.length}
            </p>
            <label htmlFor="resposta" className="block text-base font-medium">
              {session.pergunta_atual.texto}
            </label>
            <Textarea
              id="resposta"
              name="resposta"
              rows={4}
              maxLength={3000}
              autoFocus
              required
              placeholder={t("Responda com as palavras que sua empresa usa no dia a dia.")}
            />
          </div>
          <div className="flex sm:justify-end">
            <Button type="submit" disabled={pending} className="w-full sm:w-auto">
              {pending ? t("Salvando...") : t("Responder e continuar")}
            </Button>
          </div>
        </form>
      )}

      {session.status === "pronto_para_revisao" && (
        <section className="space-y-4 rounded-lg border border-primary/30 bg-primary/5 p-6">
          <div>
            <h3 className="font-medium">{t("Pronto para sua revisão")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                "Ao aprovar, esta configuração será usada nas instruções, na memória e nos ensaios do rascunho do agente. Ele ainda não ficará ativo.",
              )}{" "}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border bg-background p-4 text-sm">
              <p className="font-medium">{t("Limites do agente")}</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {session.spec.forbidden_topics.map((item) => (
                  <li key={item}>· {item}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border bg-background p-4 text-sm">
              <p className="font-medium">{t("Ensaios que faremos antes de ativar")}</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                {roteiro.map((caso) => (
                  <li key={caso.id}>· {caso.mensagem}</li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex sm:justify-end">
            <Button
              type="button"
              disabled={pending || !prontidao.ready}
              onClick={() => executar(() => aprovarConfigurador())}
              className="w-full sm:w-auto"
            >
              {pending ? t("Aprovando...") : t("Aprovar configuração")}
            </Button>
          </div>
        </section>
      )}

      <aside className="rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-sm dark:border-amber-500/30 dark:bg-amber-950/20">
        <p className="font-medium">{t("O que este atendente não fará")}</p>
        <p className="mt-1 text-muted-foreground">
          {t(
            "Não dispara mensagens, não atende grupos, não fecha diagnóstico técnico, não inventa preço e não confirma visita sem uma pessoa da empresa.",
          )}{" "}
        </p>
      </aside>
    </div>
  );
}
