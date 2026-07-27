"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { MagnifyingGlass, Plus } from "@/lib/ui/icons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api/client";
import { useChannelSessions } from "@/hooks/channels/useChannelSessions";
import { startMysteryCampaign } from "@/app/actions/mystery/startCampaign";
import { cancelMysteryCampaign } from "@/app/actions/mystery/cancelCampaign";
import { getMysteryReportUrl } from "@/app/actions/mystery/getReportUrl";
import { moveMysteryStage } from "@/app/actions/mystery/moveStage";
import { regenerateMysteryInsight, askMysteryReports } from "@/app/actions/mystery/insight";
import { MYSTERY_STAGES } from "@/lib/mystery/stages";
import { cn } from "@/lib/utils";

export interface ShopperSessionItem {
  id: string;
  label: string;
  status: string;
}

export interface ProspectItem {
  id: string;
  targetName: string | null;
  targetNumber: string;
  city: string | null;
  state: string | null;
  stage: string;
  outcome: string | null;
  economyPercent: number | null;
  avgResponseSeconds: number | null;
  endedAt: string | null;
  hasReport: boolean;
  hasTranscript: boolean;
  insight: string | null;
}

export interface CampaignItem {
  id: string;
  targetNumber: string;
  targetName: string | null;
  recipientNumber: string;
  status: string;
  outcome: string | null;
  startedAt: string;
  endedAt: string | null;
  messageCount: number;
  hasReport: boolean;
  hasTranscript: boolean;
}

const STATUS_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "warning" | "success" | "destructive" }> = {
  running: { label: "Em andamento", variant: "warning" },
  completed: { label: "Concluída", variant: "success" },
  stalled: { label: "Sem resposta", variant: "secondary" },
  failed: { label: "Falhou", variant: "destructive" },
  cancelled: { label: "Cancelada", variant: "secondary" },
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return iso;
  }
}

export function MysteryClient({
  sessions,
  campaigns,
  prospects,
}: {
  sessions: ShopperSessionItem[];
  campaigns: CampaignItem[];
  prospects: ProspectItem[];
}) {
  const router = useRouter();
  const [connectOpen, setConnectOpen] = useState(false);

  const workingSessions = sessions.filter((s) => s.status === "WORKING");

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-elevated text-accent">
            <MagnifyingGlass size={24} weight="duotone" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Cliente Oculto</h1>
            <p className="text-sm text-text-muted">
              A IA vira o cliente, audita o atendimento humano e gera um laudo.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConnectOpen(true)}>
          <Plus size={16} weight="bold" aria-hidden />
          Conectar número do oculto
        </Button>
      </header>

      <Tabs defaultValue="auditoria">
        <TabsList>
          <TabsTrigger value="auditoria">Nova auditoria</TabsTrigger>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
        </TabsList>

        <TabsContent value="auditoria" className="flex flex-col gap-4 pt-4">
          <SessionsCard sessions={sessions} />
          <NewAuditCard workingSessions={workingSessions} onStarted={() => router.refresh()} />
          {campaigns.length > 0 && (
            <CampaignsCard campaigns={campaigns} onChange={() => router.refresh()} />
          )}
        </TabsContent>

        <TabsContent value="kanban" className="pt-4">
          <ProspectFunnel prospects={prospects} onChange={() => router.refresh()} />
        </TabsContent>
      </Tabs>

      <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} onConnected={() => router.refresh()} />
    </div>
  );
}

function SessionsCard({ sessions }: { sessions: ShopperSessionItem[] }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-bold tracking-tight">Números do cliente oculto</h2>
      {sessions.length === 0 ? (
        <p className="text-xs text-text-muted">
          Nenhum número dedicado ainda. Conecte um WhatsApp separado (nunca o número de atendimento).
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-surface-elevated px-3 py-2 text-sm">
              <span className="font-medium">{s.label}</span>
              <Badge variant={s.status === "WORKING" ? "success" : "secondary"} className="text-[10px]">
                {s.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NewAuditCard({
  workingSessions,
  onStarted,
}: {
  workingSessions: ShopperSessionItem[];
  onStarted: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  // Deriva um valor SEMPRE definido p/ o Select (evita o warning
  // uncontrolled→controlled): pré-seleciona o 1º número WORKING.
  const selectedSession = sessionId ?? workingSessions[0]?.id;
  const [target, setTarget] = useState("");
  const [targetName, setTargetName] = useState("");
  const [recipient, setRecipient] = useState("");
  const [city, setCity] = useState("");
  const [uf, setUf] = useState("");
  const [personaName, setPersonaName] = useState("");
  const [goal, setGoal] = useState("agendar uma avaliação");
  const [backstory, setBackstory] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    if (!selectedSession) return toast.error("Escolha o número do oculto (WORKING).");
    if (!target.trim() || !recipient.trim() || personaName.trim().length < 2 || goal.trim().length < 3) {
      return toast.error("Preencha número-alvo, número de entrega, nome e objetivo da persona.");
    }
    setPending(true);
    try {
      const res = await startMysteryCampaign({
        shopper_session_id: selectedSession,
        target_number: target.trim(),
        target_name: targetName.trim() || undefined,
        recipient_number: recipient.trim(),
        persona_name: personaName.trim(),
        persona_goal: goal.trim(),
        persona_backstory: backstory.trim() || undefined,
        city: city.trim() || undefined,
        state: uf.trim() || undefined,
      });
      if (res.ok) {
        toast.success("Auditoria iniciada — a IA já mandou a 1ª mensagem.");
        setTarget("");
        setTargetName("");
        setCity("");
        setUf("");
        setPersonaName("");
        setBackstory("");
        onStarted();
      } else {
        const msg: Record<string, string> = {
          target_not_on_whatsapp: "Esse número não está no WhatsApp. Confira o número da empresa avaliada.",
          whatsapp_check_failed: "Não consegui verificar o número no WhatsApp (WAHA indisponível?). Tente de novo.",
          session_not_working: "O número do oculto não está conectado (status WORKING).",
          no_llm_credential: "Nenhum agente de IA publicado com credencial na organização.",
          campaign_already_running: "Já existe uma auditoria em andamento para essa empresa nesse número do oculto.",
          invalid_target_number: "Número da empresa inválido.",
          invalid_recipient_number: "Número de entrega do laudo inválido.",
        };
        toast.error(msg[res.error] ?? `Não foi possível iniciar: ${res.error}`);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="space-y-4 p-5">
      <h2 className="text-sm font-bold tracking-tight">Nova auditoria</h2>
      {workingSessions.length === 0 ? (
        <p className="text-xs text-text-muted">
          Conecte e ative um número do oculto (status WORKING) para iniciar auditorias.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Número do oculto</Label>
            <Select value={selectedSession} onValueChange={setSessionId}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha o número" />
              </SelectTrigger>
              <SelectContent>
                {workingSessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">WhatsApp da empresa avaliada</Label>
            <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome da empresa (opcional)</Label>
            <Input value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder="Ex.: Diquali Odontologia" />
          </div>
          <div className="grid grid-cols-[1fr_70px] gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Cidade (opcional)</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: Goiânia" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">UF</Label>
              <Input value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} placeholder="auto" maxLength={2} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Enviar laudo para (WhatsApp)</Label>
            <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="(11) 99999-9999" inputMode="tel" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Nome da persona (cliente)</Label>
            <Input value={personaName} onChange={(e) => setPersonaName(e.target.value)} placeholder="Ex.: Juliana Moraes" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Objetivo</Label>
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="agendar uma avaliação" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs">Contexto da persona (opcional)</Label>
            <Textarea rows={2} value={backstory} onChange={(e) => setBackstory(e.target.value)} placeholder="Ex.: primeira vez na clínica, quer saber preços e horários à tarde." />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={submit} disabled={pending}>
              {pending ? "Iniciando…" : "Iniciar auditoria"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function CampaignsCard({ campaigns, onChange }: { campaigns: CampaignItem[]; onChange: () => void }) {
  async function download(id: string, which: "report" | "transcript") {
    const res = await getMysteryReportUrl(id, which);
    if (res.ok) window.open(res.url, "_blank");
    else toast.error(res.error === "not_ready" ? "Ainda não gerado." : `Erro: ${res.error}`);
  }
  async function cancel(id: string) {
    const res = await cancelMysteryCampaign(id);
    if (res.ok) {
      toast.success("Auditoria cancelada.");
      onChange();
    } else {
      toast.error(`Erro: ${res.error}`);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-bold tracking-tight">Auditorias</h2>
      {campaigns.length === 0 ? (
        <p className="text-xs text-text-muted">Nenhuma auditoria ainda.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {campaigns.map((c) => {
            const st = STATUS_LABEL[c.status] ?? { label: c.status, variant: "secondary" as const };
            return (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.targetName || c.targetNumber}</span>
                    <Badge variant={st.variant} className="text-[10px]">
                      {st.label}
                    </Badge>
                    {c.outcome && <span className="text-[10px] text-text-muted">{c.outcome}</span>}
                  </div>
                  <span className="text-xs text-text-muted">
                    {fmt(c.startedAt)} · {c.messageCount} msgs · laudo p/ {c.recipientNumber}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.hasReport && (
                    <Button size="sm" variant="outline" onClick={() => download(c.id, "report")}>
                      Laudo
                    </Button>
                  )}
                  {c.hasTranscript && (
                    <Button size="sm" variant="ghost" onClick={() => download(c.id, "transcript")}>
                      Transcrição
                    </Button>
                  )}
                  {c.status === "running" && (
                    <Button size="sm" variant="ghost" className="text-error-fg" onClick={() => cancel(c.id)}>
                      Cancelar
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ConnectDialog({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected: () => void;
}) {
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const { data: sessionsData } = useChannelSessions({
    enabled: !!sessionId,
    refetchInterval: sessionId ? 3000 : undefined,
  });
  const current = useMemo(
    () => (sessionsData ?? []).find((s) => s.id === sessionId) ?? null,
    [sessionsData, sessionId],
  );

  useEffect(() => {
    if (!open) {
      setName("");
      setSessionId(null);
      setTick(0);
      setCreating(false);
    }
  }, [open]);

  useEffect(() => {
    if (current?.status === "WORKING") {
      toast.success("Número do oculto conectado!");
      onConnected();
      onOpenChange(false);
    }
  }, [current?.status, onConnected, onOpenChange]);

  useEffect(() => {
    if (!sessionId) return;
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [sessionId]);

  async function create() {
    setCreating(true);
    try {
      const res = await apiClient.post<{ data: { id: string } }>("/api/v1/channel-sessions", {
        display_name: name.trim() || "Cliente Oculto",
        purpose: "mystery_shopper",
      });
      setSessionId(res.data.id);
    } catch {
      toast.error("Falha ao criar a sessão. O WhatsApp (WAHA) está no ar?");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Conectar número do oculto</DialogTitle>
          <DialogDescription>
            Use um WhatsApp DEDICADO (nunca o número de atendimento). Escaneie o QR com o aparelho do
            oculto.
          </DialogDescription>
        </DialogHeader>

        {!sessionId ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ms-name">Rótulo (opcional)</Label>
              <Input id="ms-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cliente Oculto" />
            </div>
            <DialogFooter>
              <Button onClick={create} disabled={creating}>
                {creating ? "Criando…" : "Gerar QR"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-2">
            <p className="text-xs text-text-muted">
              {current?.status === "WORKING"
                ? "Conectado! Fechando…"
                : `Status: ${current?.status ?? "STARTING"} — aguardando leitura do QR…`}
            </p>
            {/* Só mostra o QR enquanto NÃO está conectado — evita 422 do proxy
                (a WAHA não tem QR quando a sessão já está WORKING). */}
            {current?.status !== "WORKING" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/v1/channel-sessions/${sessionId}/qr?t=${tick}`}
                alt="QR Code para conectar o WhatsApp do oculto"
                className="h-56 w-56 rounded border border-border bg-white object-contain"
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function fmtPct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1).replace(".", ",")}%`;
}
function fmtSecs(n: number | null): string {
  if (n == null) return "—";
  if (n < 60) return `${Math.round(n)}s`;
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return s ? `${m}min ${s}s` : `${m}min`;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-elevated px-3 py-2.5">
      <div className="text-lg font-bold tabular-nums text-text">{value}</div>
      <div className="text-[10px] text-text-muted">{label}</div>
    </div>
  );
}

function ProspectFunnel({
  prospects,
  onChange,
}: {
  prospects: ProspectItem[];
  onChange: () => void;
}) {
  const [view, setView] = useState<"kanban" | "lista">("kanban");
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [insightItem, setInsightItem] = useState<ProspectItem | null>(null);

  async function ask() {
    if (q.trim().length < 3) return;
    setAsking(true);
    setAnswer(null);
    try {
      const r = await askMysteryReports(q.trim());
      setAnswer(r.ok ? r.answer : `Erro: ${r.error}`);
    } finally {
      setAsking(false);
    }
  }

  const total = prospects.length;
  const withEconomy = prospects.filter((p) => p.economyPercent != null);
  const avgEconomy = withEconomy.length
    ? withEconomy.reduce((a, p) => a + (p.economyPercent ?? 0), 0) / withEconomy.length
    : null;
  const withResp = prospects.filter((p) => p.avgResponseSeconds != null);
  const avgResp = withResp.length
    ? withResp.reduce((a, p) => a + (p.avgResponseSeconds ?? 0), 0) / withResp.length
    : null;
  const won = prospects.filter((p) => p.stage === "fechado").length;
  const lost = prospects.filter((p) => p.stage === "perdido").length;
  const conversion = won + lost > 0 ? (won / (won + lost)) * 100 : null;

  async function move(id: string, stage: string) {
    const res = await moveMysteryStage(id, stage);
    if (res.ok) onChange();
    else toast.error(`Erro ao mover: ${res.error}`);
  }
  async function download(id: string, which: "report" | "transcript") {
    const res = await getMysteryReportUrl(id, which);
    if (res.ok) window.open(res.url, "_blank");
    else toast.error(res.error === "not_ready" ? "Ainda não gerado." : `Erro: ${res.error}`);
  }

  const loc = (p: ProspectItem) => [p.city, p.state].filter(Boolean).join("/") || p.targetNumber;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold tracking-tight">Funil de prospecção</h2>
        <div className="flex rounded-xl border border-border p-0.5">
          {(["kanban", "lista"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                view === v ? "bg-accent text-accent-foreground" : "text-text-muted hover:text-text",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Kpi label="Empresas auditadas" value={String(total)} />
        <Kpi label="Economia média" value={fmtPct(avgEconomy)} />
        <Kpi label="Resposta média (empresa)" value={fmtSecs(avgResp)} />
        <Kpi label="Fechados" value={String(won)} />
        <Kpi label="Conversão" value={conversion == null ? "—" : `${conversion.toFixed(0)}%`} />
      </div>

      {total > 0 && (
        <div className="mb-4 rounded-xl border border-border bg-surface-elevated p-4">
          <Label className="text-xs text-text-muted">Perguntar aos laudos (insights de venda)</Label>
          <div className="mt-1.5 flex items-center gap-2">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
              placeholder="Ex.: quais empresas demoram mais pra responder e valem uma abordagem?"
            />
            <Button size="sm" onClick={ask} disabled={asking || q.trim().length < 3}>
              {asking ? "Analisando…" : "Perguntar"}
            </Button>
          </div>
          {answer && (
            <p className="mt-2 whitespace-pre-wrap text-xs text-text-muted">{answer}</p>
          )}
        </div>
      )}

      {total === 0 ? (
        <p className="text-xs text-text-muted">
          Nenhuma empresa auditada ainda. Ao concluir uma auditoria, a empresa entra aqui como
          &quot;Auditado&quot;.
        </p>
      ) : view === "kanban" ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {MYSTERY_STAGES.map((st) => {
            const items = prospects.filter((p) => p.stage === st.key);
            return (
              <div key={st.key} className="w-56 shrink-0">
                <div className="mb-2 flex items-center justify-between border-b border-border pb-1.5">
                  <span className="text-xs font-bold tracking-tight">{st.label}</span>
                  <span className="text-[10px] font-semibold tabular-nums text-text-muted">{items.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {items.map((p) => (
                    <div key={p.id} className="rounded-xl border border-border bg-surface-elevated p-2.5 text-xs">
                      <div className="font-semibold text-text">{p.targetName || p.targetNumber}</div>
                      <div className="text-[11px] text-text-muted">{loc(p)}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {p.economyPercent != null && (
                          <Badge variant="secondary" className="text-[10px]">
                            economia {fmtPct(p.economyPercent)}
                          </Badge>
                        )}
                        {p.hasReport && (
                          <button
                            type="button"
                            onClick={() => download(p.id, "report")}
                            className="text-[10px] text-accent underline"
                          >
                            laudo
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setInsightItem(p)}
                          className="text-[10px] text-accent underline"
                        >
                          insight
                        </button>
                      </div>
                      <Select value={p.stage} onValueChange={(v) => move(p.id, v)}>
                        <SelectTrigger className="mt-2 h-7 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MYSTERY_STAGES.map((s) => (
                            <SelectItem key={s.key} value={s.key}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-text-muted">
                <th className="py-1.5 pr-2">Empresa</th>
                <th className="pr-2">WhatsApp</th>
                <th className="pr-2">Cidade/UF</th>
                <th className="pr-2">Economia</th>
                <th className="pr-2">Resp. média</th>
                <th className="pr-2">Etapa</th>
                <th>Laudo</th>
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => (
                <tr key={p.id} className="border-b border-border/60">
                  <td className="py-1.5 pr-2 font-medium">{p.targetName || "—"}</td>
                  <td className="pr-2">{p.targetNumber}</td>
                  <td className="pr-2">{[p.city, p.state].filter(Boolean).join("/") || "—"}</td>
                  <td className="pr-2">{fmtPct(p.economyPercent)}</td>
                  <td className="pr-2">{fmtSecs(p.avgResponseSeconds)}</td>
                  <td className="pr-2">
                    <Select value={p.stage} onValueChange={(v) => move(p.id, v)}>
                      <SelectTrigger className="h-7 w-32 text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MYSTERY_STAGES.map((s) => (
                          <SelectItem key={s.key} value={s.key}>
                            {s.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1.5">
                    <div className="flex gap-2">
                      {p.hasReport && (
                        <button type="button" onClick={() => download(p.id, "report")} className="text-accent underline">
                          laudo
                        </button>
                      )}
                      {p.hasTranscript && (
                        <button
                          type="button"
                          onClick={() => download(p.id, "transcript")}
                          className="text-text-muted underline"
                        >
                          transcrição
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setInsightItem(p)}
                        className="text-accent underline"
                      >
                        insight
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InsightDialog item={insightItem} onOpenChange={(v) => !v && setInsightItem(null)} />
    </Card>
  );
}

function InsightDialog({
  item,
  onOpenChange,
}: {
  item: ProspectItem | null;
  onOpenChange: (v: boolean) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setText(item?.insight ?? null);
  }, [item]);

  async function regen() {
    if (!item) return;
    setPending(true);
    try {
      const r = await regenerateMysteryInsight(item.id);
      if (r.ok) {
        setText(r.insight);
        toast.success("Insight atualizado.");
      } else {
        toast.error(`Erro: ${r.error}`);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Insight de venda — {item?.targetName || item?.targetNumber}</DialogTitle>
          <DialogDescription>
            Argumento gerado a partir do laudo real, para abordar a empresa com o Agente de IA da
            Lua CRM.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-auto whitespace-pre-wrap text-sm text-text">
          {text || "Ainda não há insight gerado para esta empresa. Clique em “Gerar insight”."}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Fechar
          </Button>
          <Button type="button" onClick={regen} disabled={pending}>
            {pending ? "Gerando…" : text ? "Regenerar" : "Gerar insight"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
