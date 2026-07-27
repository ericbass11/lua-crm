"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

interface Step {
  delay_minutes: number;
  hint: string;
}

interface Settings {
  enabled: boolean;
  timezone: string;
  send_window: { days: number[]; start: string; end: string };
  steps: Step[];
}

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function fmtDelay(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} dia(s)`;
}

export function FollowupClient() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiClient.get<{ data: Settings }>("/api/v1/settings/followup");
        setSettings(res.data);
      } catch (err) {
        showApiError(err);
      }
    })();
  }, []);

  if (!settings) return <Card className="max-w-3xl p-5 text-sm text-text-muted">Carregando…</Card>;

  const patch = (p: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...p } : s));
  const patchStep = (i: number, p: Partial<Step>) =>
    patch({ steps: settings.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });

  const toggleDay = (d: number) =>
    patch({
      send_window: {
        ...settings.send_window,
        days: settings.send_window.days.includes(d)
          ? settings.send_window.days.filter((x) => x !== d)
          : [...settings.send_window.days, d].sort(),
      },
    });

  const onSave = async () => {
    if (settings.steps.some((s) => !s.delay_minutes || s.delay_minutes < 2)) {
      toast.error("Cada etapa precisa de um tempo de inatividade (mínimo 2 minutos).");
      return;
    }
    if (settings.send_window.days.length === 0) {
      toast.error("Selecione ao menos um dia de envio.");
      return;
    }
    setSaving(true);
    try {
      await apiClient.patch("/api/v1/settings/followup", settings);
      toast.success(settings.enabled ? "Follow-up ativado." : "Configuração salva (desativado).");
    } catch (err) {
      showApiError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      <Card className="flex items-center justify-between p-5">
        <div>
          <h2 className="text-base font-semibold">Ativar follow-up automático</h2>
          <p className="text-sm text-text-muted">
            Vale para conversas com a IA e também com atendente humano — nesse caso a IA envia
            apenas a mensagem de reengajamento, sem assumir a conversa. Nunca segue clientes
            bloqueados ou pós-handoff.
          </p>
        </div>
        <Switch checked={settings.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
      </Card>

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-base font-semibold">Sequência ({settings.steps.length} etapas)</h2>
          <p className="text-sm text-text-muted">
            Cada etapa dispara após o tempo de silêncio contado da última mensagem da conversa. A
            instrução orienta o tom daquele follow-up — o conteúdo é gerado pela IA com base na
            conversa real.
          </p>
        </div>
        {settings.steps.map((step, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                Follow-up {i + 1} · após {fmtDelay(step.delay_minutes)} sem resposta
              </span>
              {settings.steps.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => patch({ steps: settings.steps.filter((_, j) => j !== i) })}
                >
                  Remover
                </Button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
              <div className="space-y-1">
                <Label htmlFor={`fu-delay-${i}`}>Inatividade (minutos)</Label>
                <Input
                  id={`fu-delay-${i}`}
                  type="number"
                  min={2}
                  max={20160}
                  value={step.delay_minutes}
                  onChange={(e) => patchStep(i, { delay_minutes: Number(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`fu-hint-${i}`}>Instrução de tom (opcional)</Label>
                <Input
                  id={`fu-hint-${i}`}
                  value={step.hint}
                  maxLength={300}
                  placeholder="Ex.: retome a última pergunta de forma leve"
                  onChange={(e) => patchStep(i, { hint: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}
        {settings.steps.length < 5 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              patch({
                steps: [...settings.steps, { delay_minutes: 1440, hint: "" }],
              })
            }
          >
            + Adicionar etapa
          </Button>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <div>
          <h2 className="text-base font-semibold">Janela de envio</h2>
          <p className="text-sm text-text-muted">
            Follow-ups só saem nestes dias/horários (fuso {settings.timezone}). Fora da janela, a
            etapa espera a próxima abertura — proteção anti-banimento do WhatsApp.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DAY_LABELS.map((label, d) => (
            <Button
              key={label}
              type="button"
              size="sm"
              variant={settings.send_window.days.includes(d) ? "default" : "outline"}
              onClick={() => toggleDay(d)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="grid max-w-xs grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="fu-start">Início</Label>
            <Input
              id="fu-start"
              type="time"
              value={settings.send_window.start}
              onChange={(e) =>
                patch({ send_window: { ...settings.send_window, start: e.target.value } })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fu-end">Fim</Label>
            <Input
              id="fu-end"
              type="time"
              value={settings.send_window.end}
              onChange={(e) =>
                patch({ send_window: { ...settings.send_window, end: e.target.value } })
              }
            />
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Salvando…" : "Salvar configuração"}
        </Button>
      </div>
    </div>
  );
}
