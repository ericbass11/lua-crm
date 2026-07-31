"use client";
/**
 * Proteção de envio (anti-ban) por conexão — Operação Visível F2ii. Edita os
 * knobs que o engine JÁ respeita (channel_knobs + teto diário). Modelo mental
 * honesto com o motor: campo vazio = padrão conservador do engine (placeholder
 * mostra o valor); preenchido = override desta conexão.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useUpdatePacingKnobs, type PacingKnobsItem } from "@/hooks/channels/usePacingKnobs";
import {
  descreveErroDeValidacao,
  lerDataAtivacao,
  lerInteiro,
  lerSegundosEmMs,
} from "@/lib/ai/pacing-form";
import { ApiError } from "@/lib/api/types";

interface Props {
  item: PacingKnobsItem | null;
  canWrite: boolean;
  onClose: () => void;
}

/** estado do form: strings cruas dos inputs ('' = usar padrão do motor). */
interface FormState {
  window_start_hour: string;
  window_end_hour: string;
  throttle_s: string;
  jitter_s: string;
  daily_message_limit: string;
  allow_sunday: boolean;
  timezone: string;
  /** `YYYY-MM-DD` do input de data; '' = manter a data já registrada. */
  number_activated_at: string;
}

function fromItem(item: PacingKnobsItem): FormState {
  const o = item.overrides;
  return {
    window_start_hour: o?.window_start_hour != null ? String(o.window_start_hour) : "",
    window_end_hour: o?.window_end_hour != null ? String(o.window_end_hour) : "",
    throttle_s: o?.throttle_ms != null ? String(o.throttle_ms / 1000) : "",
    jitter_s: o?.jitter_max_ms != null ? String(o.jitter_max_ms / 1000) : "",
    daily_message_limit:
      item.channel_session.daily_message_limit != null
        ? String(item.channel_session.daily_message_limit)
        : "",
    allow_sunday: o?.allow_sunday ?? item.defaults.allowSunday,
    timezone: o?.timezone ?? "",
    // Só a parte da data: o input é `type="date"` e o banco guarda timestamptz.
    number_activated_at: o?.number_activated_at
      ? String(o.number_activated_at).slice(0, 10)
      : "",
  };
}

export function AntiBanSheet({ item, canWrite, onClose }: Props) {
  const update = useUpdatePacingKnobs();
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    setForm(item ? fromItem(item) : null);
  }, [item]);

  const label = useMemo(() => {
    if (!item) return "";
    const s = item.channel_session;
    return s.display_name || s.phone_number || s.waha_session_name || "Conexão";
  }, [item]);

  if (!item || !form) return null;
  const eff = item.effective;
  /** Teto de intervalo na unidade do campo (o motor guarda em ms). */
  const maxIntervalS = item.bounds.intervalMaxMs / 1000;
  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const handleSave = async () => {
    // Lê tudo ANTES de chamar a API: o limite de cada campo é dito na unidade do
    // campo (segundos, hora), não em ms — o operador não pensa em milissegundos.
    const campos = [
      lerInteiro(form.window_start_hour, "Início da janela", 0, item.bounds.hourLastStart),
      lerInteiro(form.window_end_hour, "Fim da janela", 1, item.bounds.hourEnd),
      lerSegundosEmMs(form.throttle_s, "Ritmo entre envios", item.bounds.intervalMaxMs),
      lerSegundosEmMs(form.jitter_s, "Variação do ritmo", item.bounds.intervalMaxMs),
      lerInteiro(
        form.daily_message_limit,
        "Teto diário",
        item.bounds.daily_limit.min,
        item.bounds.daily_limit.max,
      ),
    ] as const;
    const ativacao = lerDataAtivacao(form.number_activated_at, new Date());
    const invalido = [...campos, ativacao].find((c) => !c.ok);
    if (invalido && !invalido.ok) {
      toast.error(invalido.erro);
      return;
    }
    const [inicio, fim, throttleMs, jitterMs, tetoDiario] = campos.map((c) =>
      c.ok ? c.valor : null,
    );

    // Janela coerente checada aqui também: a API valida o par resultante e
    // devolveria 422, mas dizer "20h antes de 8h" na hora é mais útil.
    if (inicio != null && fim != null && inicio >= fim) {
      toast.error(`Janela inválida: o início (${inicio}h) precisa ser antes do fim (${fim}h).`);
      return;
    }

    try {
      await update.mutateAsync({
        channel_session_id: item.channel_session.id,
        window_start_hour: inicio,
        window_end_hour: fim,
        throttle_ms: throttleMs,
        jitter_max_ms: jitterMs,
        allow_sunday: form.allow_sunday,
        timezone: form.timezone.trim() === "" ? null : form.timezone.trim(),
        // Teto diário ausente do payload = não mexer (a rota só escreve se veio).
        ...(tetoDiario != null ? { daily_message_limit: tetoDiario } : {}),
        // Idem para a ativação: campo vazio não vai no payload, então a data já
        // registrada permanece (a rota só a define quando CRIA a linha).
        ...(ativacao.ok && ativacao.valor != null
          ? { number_activated_at: ativacao.valor }
          : {}),
      });
      toast.success("Proteção de envio atualizada.");
      onClose();
    } catch (err) {
      if (err instanceof ApiError) {
        // `details` traz o campo e o limite que o Zod recusou; sem isto o
        // operador só via "Campos inválidos." e não tinha o que corrigir.
        const detalhe = descreveErroDeValidacao(err.details);
        toast.error(detalhe ? `${err.message} (${detalhe})` : err.message);
        return;
      }
      toast.error("Não foi possível salvar.");
    }
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Proteção de envio — {label}</SheetTitle>
          <SheetDescription>
            Estes limites protegem o número contra bloqueio do WhatsApp. Campo vazio usa o
            padrão seguro do sistema (mostrado no campo).
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4 py-2" data-testid="anti-ban-form">
          <fieldset className="flex flex-col gap-2">
            <Label>Janela de envio (horário local)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={23}
                inputMode="numeric"
                placeholder={String(eff.windowStartHour)}
                value={form.window_start_hour}
                onChange={(e) => set({ window_start_hour: e.target.value })}
                disabled={!canWrite}
                aria-label="Hora de início da janela"
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">h até</span>
              <Input
                type="number"
                min={1}
                max={24}
                inputMode="numeric"
                placeholder={String(eff.windowEndHour)}
                value={form.window_end_hour}
                onChange={(e) => set({ window_end_hour: e.target.value })}
                disabled={!canWrite}
                aria-label="Hora de fim da janela"
                className="w-20"
              />
              <span className="text-sm text-muted-foreground">h</span>
            </div>
            <p className="text-xs text-muted-foreground">
              O assistente só envia mensagens dentro desta janela. Fora dela, a resposta fica
              agendada para a próxima abertura — você vê o motivo na conversa.
            </p>
          </fieldset>

          <fieldset className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="allow-sunday">Enviar aos domingos</Label>
              <p className="text-xs text-muted-foreground">
                Desligado por padrão: envio em domingo aumenta o risco de denúncia e bloqueio.
              </p>
            </div>
            <Switch
              id="allow-sunday"
              checked={form.allow_sunday}
              onCheckedChange={(v) => set({ allow_sunday: v })}
              disabled={!canWrite}
            />
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <Label>Ritmo entre envios (segundos)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={maxIntervalS}
                step="0.1"
                inputMode="decimal"
                placeholder={String(eff.throttleMs / 1000)}
                value={form.throttle_s}
                onChange={(e) => set({ throttle_s: e.target.value })}
                disabled={!canWrite}
                aria-label="Intervalo mínimo entre envios em segundos"
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">+ variação de até</span>
              <Input
                type="number"
                min={0}
                max={maxIntervalS}
                step="0.1"
                inputMode="decimal"
                placeholder={String(eff.jitterMaxMs / 1000)}
                value={form.jitter_s}
                onChange={(e) => set({ jitter_s: e.target.value })}
                disabled={!canWrite}
                aria-label="Variação aleatória máxima em segundos"
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">s</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Intervalo mínimo entre mensagens do mesmo número, mais uma variação aleatória —
              ritmo cravado parece robô para o WhatsApp. Máximo de {maxIntervalS}s em cada campo.
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <Label>Teto diário de envios</Label>
            <Input
              type="number"
              min={item.bounds.daily_limit.min}
              max={item.bounds.daily_limit.max}
              inputMode="numeric"
              placeholder="sem teto definido"
              value={form.daily_message_limit}
              onChange={(e) => set({ daily_message_limit: e.target.value })}
              disabled={!canWrite}
              aria-label="Teto diário de mensagens"
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              Máximo de mensagens que este número envia por dia. Números novos também respeitam
              o aquecimento automático abaixo, o que for menor.
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <Label>Fuso horário da janela</Label>
            <Input
              placeholder={eff.timezone}
              value={form.timezone}
              onChange={(e) => set({ timezone: e.target.value })}
              disabled={!canWrite}
              aria-label="Fuso horário IANA"
            />
            <p className="text-xs text-muted-foreground">
              A janela de envio é avaliada neste fuso (ex.: America/Sao_Paulo).
            </p>
          </fieldset>

          <div className="rounded-md border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium">Aquecimento automático de número novo</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {eff.warmupDailyCaps
                .map((s) =>
                  s.cap === null
                    ? `a partir de ${s.minAgeDays} dias: sem limite de aquecimento`
                    : `${s.minAgeDays}+ dias: até ${s.cap}/dia`,
                )
                .join(" · ")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Número recém-conectado envia pouco e sobe aos poucos — enviar demais no início é
              a causa nº 1 de bloqueio.
            </p>

            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              <Label htmlFor="ativo-desde">Número ativo desde</Label>
              <Input
                id="ativo-desde"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={form.number_activated_at}
                onChange={(e) => set({ number_activated_at: e.target.value })}
                disabled={!canWrite}
                aria-label="Data em que o número começou a enviar"
                className="w-44"
              />
              <p className="text-xs text-muted-foreground">
                Define em que degrau do aquecimento o número está. Por padrão é a data em que
                a conexão foi criada aqui. Só mude se o número já enviava antes por outro
                sistema — informar data mais antiga <strong>libera limites mais altos</strong>,
                e errar isso é assumir risco de bloqueio.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-auto flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={onClose}>
            {canWrite ? "Cancelar" : "Fechar"}
          </Button>
          {canWrite ? (
            <Button onClick={handleSave} disabled={update.isPending} data-testid="anti-ban-save">
              {update.isPending ? "Salvando…" : "Salvar proteção"}
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
