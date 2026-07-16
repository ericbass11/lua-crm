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

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api/client";

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

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

const PERIODS = [7, 30, 90];

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
          <Button
            key={p}
            size="sm"
            variant={days === p ? "default" : "outline"}
            onClick={() => setDays(p)}
          >
            {p} dias
          </Button>
        ))}
      </div>

      {loading || !data ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Conversas" value={String(data.conversations)} sub={`${data.inbound_total} msgs recebidas`} />
            <Kpi label="Leads" value={String(data.leads_total)} />
            <Kpi label="Conversão" value={`${data.conversion_pct}%`} sub={`${data.won_count} ganhos`} />
            <Kpi label="Resolvido pela IA" value={`${autoPct}%`} sub={`${data.ai.handoffs} handoffs`} />
            <Kpi label="Respostas da IA" value={String(data.ai.replies)} />
            <Kpi label="Follow-ups" value={String(data.followups_sent)} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Funil de leads</h2>
              <div className="mt-3 space-y-2">
                {data.funnel.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem leads no funil ainda.</p>
                ) : (
                  data.funnel.map((f) => (
                    <div key={f.stage} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className={f.is_won ? "text-green-600 dark:text-green-400" : f.is_lost ? "text-muted-foreground" : ""}>
                          {f.stage}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{f.count}</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-elevated">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(f.count / maxFunnel) * 100}%`,
                            backgroundColor: f.is_won
                              ? "#22c55e"
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
              <div className="mt-4 flex gap-3 text-xs text-muted-foreground">
                <span>🔥 Quente: {data.score_buckets.quente}</span>
                <span>🟡 Morno: {data.score_buckets.morno}</span>
                <span>❄️ Frio: {data.score_buckets.frio}</span>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Mensagens recebidas por horário</h2>
                <span className="text-[11px] text-muted-foreground">
                  <span className="mr-2 inline-flex items-center gap-1">
                    <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: "var(--color-accent)" }} />
                    comercial
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: "var(--color-border-strong)" }} />
                    fora
                  </span>
                </span>
              </div>
              <div className="mt-3 h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9, fill: "var(--color-text-muted)" }}
                      interval={1}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
                      axisLine={false}
                      tickLine={false}
                      width={28}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--color-surface-elevated)" }}
                      contentStyle={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--color-text)",
                      }}
                    />
                    <Bar name="Recebidas" dataKey="inbound" radius={[3, 3, 0, 0]}>
                      {hourlyData.map((h) => (
                        <Cell
                          key={h.hour}
                          fill={h.commercial ? "var(--color-accent)" : "var(--color-border-strong)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Janela comercial: {String(data.business_hours.start).padStart(2, "0")}h–
                {String(data.business_hours.end).padStart(2, "0")}h (fuso America/Sao_Paulo).
              </p>
            </Card>
          </div>

          {data.capped && (
            <p className="text-xs text-muted-foreground">
              * Volume alto: métricas de mensagens amostradas nas mais recentes do período.
            </p>
          )}
        </>
      )}
    </div>
  );
}
