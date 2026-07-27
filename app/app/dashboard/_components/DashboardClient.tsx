"use client";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api/client";
import { ChatCircle, Users, Robot } from "@/lib/ui/icons";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

interface Metrics {
  days: number;
  funnel: Array<{ stage: string; count: number; value_cents: number; is_won: boolean; is_lost: boolean }>;
  leads_total: number;
  won_count: number;
  conversion_pct: number;
  score_buckets: { quente: number; morno: number; frio: number };
  ai: { replies: number; handoffs: number; followup_runs: number };
  conversations: number;
  inbound_total: number;
  followups_sent: number;
  hourly: Array<{ hour: number; inbound: number; outbound: number }>;
  business_hours: { start: number; end: number };
  capped: boolean;
}

const PERIODS = [7, 30, 90];

/** Card branco arredondado com título — base do layout Buzzy CRM. */
function Panel({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 shadow-sm ${className ?? ""}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Stat card do Figma: número grande + badge de ícone em gradiente pastel. */
function StatCard({ label, value, sub, icon: Icon, gradient }: { label: string; value: string; sub?: string; icon: PhosphorIcon; gradient: string }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-muted">{label}</p>
          <p className="mt-1 text-[40px] font-bold leading-none tracking-tight tabular-nums">{value}</p>
          {sub && <p className="mt-1.5 text-xs text-text-subtle">{sub}</p>}
        </div>
        <span className="grid size-14 place-items-center rounded-full text-white" style={{ background: gradient }}>
          <Icon size={26} weight="fill" aria-hidden />
        </span>
      </div>
    </section>
  );
}

export function DashboardClient() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await apiClient.get<{ data: Metrics }>(`/api/v1/dashboard/metrics?days=${days}`);
        if (!cancelled) setData(res.data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  const hourlyData = useMemo(() => {
    if (!data) return [];
    const { start, end } = data.business_hours;
    return data.hourly.map((h) => ({
      ...h,
      label: `${String(h.hour).padStart(2, "0")}h`,
      commercial: h.hour >= start && h.hour < end,
    }));
  }, [data]);

  const aiTotal = (data?.ai.replies ?? 0) + (data?.ai.handoffs ?? 0);
  const autoPct = aiTotal > 0 ? Math.round(((data?.ai.replies ?? 0) / aiTotal) * 100) : 0;
  const maxFunnel = Math.max(1, ...(data?.funnel.map((f) => f.count) ?? [1]));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1.5">
        {PERIODS.map((p) => (
          <Button key={p} size="sm" variant={days === p ? "default" : "outline"} onClick={() => setDays(p)}>
            {p} dias
          </Button>
        ))}
      </div>

      {loading || !data ? (
        <div className="grid gap-5 lg:grid-cols-[300px_1fr_320px]">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[300px_1fr_320px]">
          {/* ── Coluna esquerda: hero + stat cards ── */}
          <div className="space-y-5">
            <div
              className="relative overflow-hidden rounded-xl p-6 text-white shadow-lg"
              style={{ background: "linear-gradient(150deg, var(--color-accent-500), var(--color-accent-700))" }}
            >
              <span className="pointer-events-none absolute -bottom-16 -right-12 size-52 rounded-full bg-white/10" />
              <p className="text-xs uppercase tracking-wider opacity-85">Destaque do período</p>
              <p className="mt-2 text-[44px] font-bold leading-none tabular-nums">{data.conversion_pct}%</p>
              <p className="mt-1 text-sm opacity-90">de conversão · {data.won_count} negócios ganhos</p>
              <div className="mt-5 flex gap-8">
                <div>
                  <span className="block text-xs opacity-80">Leads</span>
                  <b className="text-lg">{data.leads_total}</b>
                </div>
                <div>
                  <span className="block text-xs opacity-80">Follow-ups</span>
                  <b className="text-lg">{data.followups_sent}</b>
                </div>
              </div>
            </div>

            <StatCard
              label="Conversas"
              value={String(data.conversations)}
              sub={`${data.inbound_total} mensagens recebidas`}
              icon={ChatCircle}
              gradient="linear-gradient(135deg,#ff7a70,#f0506e)"
            />
            <StatCard
              label="Leads ativos"
              value={String(data.leads_total)}
              sub={`${data.won_count} ganhos no período`}
              icon={Users}
              gradient="linear-gradient(135deg,#38c7a0,#2aa5b8)"
            />
          </div>

          {/* ── Coluna central: funil + gráfico ── */}
          <div className="space-y-5">
            <Panel title="Funil de leads">
              <div className="space-y-2.5">
                {data.funnel.length === 0 ? (
                  <p className="text-xs text-text-muted">Sem leads no funil ainda.</p>
                ) : (
                  data.funnel.map((f) => (
                    <div key={f.stage} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className={f.is_won ? "font-medium text-success" : f.is_lost ? "text-text-subtle" : "text-text"}>
                          {f.stage}
                        </span>
                        <span className="tabular-nums text-text-muted">{f.count}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-elevated">
                        <div
                          className="h-full rounded-full transition-[width] duration-500"
                          style={{
                            width: `${(f.count / maxFunnel) * 100}%`,
                            backgroundColor: f.is_won
                              ? "var(--color-success)"
                              : f.is_lost
                                ? "var(--color-border-strong)"
                                : "var(--color-accent)",
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>

            <Panel
              title="Mensagens por horário"
              action={
                <span className="text-[11px] text-text-muted">
                  <span className="mr-2 inline-flex items-center gap-1">
                    <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: "var(--color-accent)" }} />
                    comercial
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: "var(--color-border-strong)" }} />
                    fora
                  </span>
                </span>
              }
            >
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 9, fill: "var(--color-text-muted)" }} interval={1} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip
                      cursor={{ fill: "var(--color-surface-elevated)" }}
                      contentStyle={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 10,
                        fontSize: 12,
                        color: "var(--color-text)",
                      }}
                    />
                    <Bar name="Recebidas" dataKey="inbound" radius={[4, 4, 0, 0]}>
                      {hourlyData.map((h) => (
                        <Cell key={h.hour} fill={h.commercial ? "var(--color-accent)" : "var(--color-border-strong)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-[11px] text-text-muted">
                Janela comercial: {String(data.business_hours.start).padStart(2, "0")}h–
                {String(data.business_hours.end).padStart(2, "0")}h (America/Sao_Paulo).
              </p>
            </Panel>
          </div>

          {/* ── Coluna direita: concentração + IA ── */}
          <div className="space-y-5">
            <Panel title="Concentração de leads">
              <ul className="space-y-3">
                {[
                  { k: "Quente", v: data.score_buckets.quente, c: "var(--color-error)" },
                  { k: "Morno", v: data.score_buckets.morno, c: "var(--color-warning)" },
                  { k: "Frio", v: data.score_buckets.frio, c: "var(--color-info)" },
                ].map((row) => (
                  <li key={row.k} className="flex items-center gap-3">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: row.c }} />
                    <span className="flex-1 text-sm text-text">{row.k}</span>
                    <span className="text-sm font-semibold tabular-nums">{row.v}</span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Desempenho da IA">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[28px] font-bold leading-none tabular-nums">{autoPct}%</p>
                  <p className="mt-1 text-xs text-text-muted">resolvido pela IA</p>
                </div>
                <div>
                  <p className="text-[28px] font-bold leading-none tabular-nums">{data.ai.replies}</p>
                  <p className="mt-1 text-xs text-text-muted">respostas da IA</p>
                </div>
                <div>
                  <p className="text-[28px] font-bold leading-none tabular-nums">{data.ai.handoffs}</p>
                  <p className="mt-1 text-xs text-text-muted">handoffs</p>
                </div>
                <div>
                  <p className="text-[28px] font-bold leading-none tabular-nums">{data.followups_sent}</p>
                  <p className="mt-1 text-xs text-text-muted">follow-ups</p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-border pt-3 text-xs text-text-muted">
                <Robot size={16} weight="fill" className="text-accent" aria-hidden />
                {data.ai.followup_runs} execuções de follow-up automático
              </div>
            </Panel>
          </div>
        </div>
      )}

      {data?.capped && (
        <p className="text-xs text-text-muted">
          * Volume alto: métricas de mensagens amostradas nas mais recentes do período.
        </p>
      )}
    </div>
  );
}
