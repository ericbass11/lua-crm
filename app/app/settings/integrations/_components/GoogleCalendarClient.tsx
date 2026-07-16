"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

export interface CalendarIntegrationSafeRow {
  id: string;
  organization_id: string;
  provider: string;
  label: string;
  calendar_id: string;
  service_account_email: string;
  timezone: string;
  slot_minutes: number;
  business_hours: { days: number[]; start: string; end: string };
  is_active: boolean;
  validated_at: string | null;
  validation_error: string | null;
  created_at: string;
}

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

interface CreateResponse {
  data: CalendarIntegrationSafeRow;
}

export function GoogleCalendarClient({ initialData }: { initialData: CalendarIntegrationSafeRow[] }) {
  const router = useRouter();
  const existing = initialData[0] ?? null;

  const [calendarId, setCalendarId] = useState("");
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startHour, setStartHour] = useState("09:00");
  const [endHour, setEndHour] = useState("18:00");
  const [saJson, setSaJson] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!saJson.trim()) {
      toast.error("Cole o JSON da Service Account.");
      return;
    }
    if (days.length === 0) {
      toast.error("Selecione ao menos um dia de atendimento.");
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post<CreateResponse>("/api/v1/integrations/calendar", {
        label: "Agenda principal",
        calendar_id: calendarId.trim() || "primary",
        service_account_json: saJson,
        timezone: timezone.trim(),
        slot_minutes: slotMinutes,
        business_hours: { days, start: startHour, end: endHour },
      });
      setSaJson("");
      toast.success("Agenda conectada. Validando acesso em segundo plano…");
      // Validação async leva ~2s; recarrega pra refletir o status.
      setTimeout(() => router.refresh(), 3000);
      router.refresh();
    } catch (err) {
      showApiError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/api/v1/integrations/calendar/${existing.id}`);
      toast.success("Integração removida.");
      router.refresh();
    } catch (err) {
      showApiError(err);
    } finally {
      setDeleting(false);
    }
  };

  if (existing) {
    const validated = Boolean(existing.validated_at);
    return (
      <Card className="max-w-2xl space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Google Calendar</h2>
          {validated ? (
            <Badge>Conectada ✓</Badge>
          ) : existing.validation_error ? (
            <Badge variant="destructive">Erro de acesso</Badge>
          ) : (
            <Badge variant="secondary">Validando…</Badge>
          )}
        </div>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Agenda</dt>
            <dd className="font-medium">{existing.calendar_id}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Robô (Service Account)</dt>
            <dd className="break-all font-medium">{existing.service_account_email}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Fuso / duração da call</dt>
            <dd className="font-medium">
              {existing.timezone} · {existing.slot_minutes} min
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Atendimento</dt>
            <dd className="font-medium">
              {existing.business_hours.days.map((d) => DAY_LABELS[d]).join(", ")} ·{" "}
              {existing.business_hours.start}–{existing.business_hours.end}
            </dd>
          </div>
        </dl>
        {existing.validation_error ? (
          <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
            {existing.validation_error}
          </p>
        ) : null}
        {!validated && !existing.validation_error ? (
          <p className="text-xs text-muted-foreground">
            A validação roda em segundo plano — recarregue a página em alguns segundos.
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button variant="destructive" onClick={onDelete} disabled={deleting}>
            {deleting ? "Removendo…" : "Desconectar agenda"}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="space-y-3 p-5 text-sm">
        <h2 className="text-base font-semibold">Como conectar (5 min)</h2>
        <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
          <li>
            Acesse{" "}
            <a
              className="underline"
              href="https://console.cloud.google.com/projectcreate"
              target="_blank"
              rel="noreferrer"
            >
              console.cloud.google.com
            </a>{" "}
            e crie um projeto (qualquer nome).
          </li>
          <li>
            Em <strong>APIs e serviços → Biblioteca</strong>, procure{" "}
            <strong>Google Calendar API</strong> e clique em <strong>Ativar</strong>.
          </li>
          <li>
            Em <strong>IAM e administrador → Contas de serviço</strong>, crie uma conta de
            serviço (o &quot;robô&quot; que acessa a agenda; não precisa de papel/role).
          </li>
          <li>
            Na conta criada, aba <strong>Chaves → Adicionar chave → JSON</strong>. Um arquivo
            será baixado — cole o conteúdo dele no campo ao lado.
          </li>
          <li>
            No{" "}
            <a className="underline" href="https://calendar.google.com" target="_blank" rel="noreferrer">
              Google Calendar
            </a>
            , abra as configurações da sua agenda → <strong>Compartilhar com pessoas
            específicas</strong> → adicione o e-mail do robô (algo como{" "}
            <code>nome@projeto.iam.gserviceaccount.com</code>) com permissão{" "}
            <strong>&quot;Fazer alterações em eventos&quot;</strong>.
          </li>
          <li>
            No campo &quot;ID da agenda&quot; ao lado, informe o e-mail da agenda
            compartilhada (o seu e-mail do Google, na agenda principal).
          </li>
        </ol>
      </Card>

      <Card className="p-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 className="text-base font-semibold">Conectar Google Calendar</h2>

          <div className="space-y-2">
            <Label htmlFor="cal-sa-json">Chave JSON da Service Account</Label>
            <Textarea
              id="cal-sa-json"
              value={saJson}
              onChange={(e) => setSaJson(e.target.value)}
              placeholder='{"type": "service_account", "project_id": "...", "private_key": "...", "client_email": "..."}'
              rows={6}
              className="font-mono text-xs"
              required
            />
            <p className="text-xs text-muted-foreground">
              Cifrada antes de gravar (AES-GCM); nunca é exibida de volta.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cal-id">ID da agenda</Label>
            <Input
              id="cal-id"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              placeholder="seuemail@gmail.com"
              required
            />
            <p className="text-xs text-muted-foreground">
              O e-mail da agenda compartilhada com o robô (passo 5 e 6).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cal-tz">Fuso horário</Label>
              <Input id="cal-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cal-slot">Duração da call (min)</Label>
              <Input
                id="cal-slot"
                type="number"
                min={10}
                max={240}
                value={slotMinutes}
                onChange={(e) => setSlotMinutes(Number(e.target.value) || 30)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Dias de atendimento</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABELS.map((label, d) => (
                <Button
                  key={label}
                  type="button"
                  size="sm"
                  variant={days.includes(d) ? "default" : "outline"}
                  onClick={() => toggleDay(d)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cal-start">Início</Label>
              <Input
                id="cal-start"
                type="time"
                value={startHour}
                onChange={(e) => setStartHour(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cal-end">Fim</Label>
              <Input id="cal-end" type="time" value={endHour} onChange={(e) => setEndHour(e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Conectando…" : "Conectar agenda"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
