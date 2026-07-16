"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tag, Receipt, Users, ArrowRight } from "@/lib/ui/icons";
import { apiClient } from "@/lib/api/client";
import type { ConversationWithContact } from "@/hooks/inbox/useConversationsRealtime";

interface Props {
  conversation: ConversationWithContact | null;
}

interface LeadRow {
  id: string;
  title: string;
  status: string;
  value_cents: number | null;
  currency: string | null;
  updated_at: string;
  custom_fields: Record<string, unknown> | null;
  crm_stages: { name: string } | { name: string }[] | null;
}

const FIELD_ORDER: Array<{ key: string; label: string }> = [
  { key: "segmento", label: "Segmento" },
  { key: "orcamento_declarado", label: "Orçamento" },
  { key: "urgencia", label: "Urgência" },
  { key: "dor_principal", label: "Dor" },
  { key: "objecoes", label: "Objeções" },
  { key: "proximo_passo", label: "Próximo passo" },
];

interface OrderRow {
  id: string;
  external_id: string | null;
  status: string | null;
  total_cents: number | null;
  currency: string | null;
  created_at: string;
}

interface ActivityRow {
  id: string;
  type: string;
  source_module: string;
  performed_at: string;
  payload: Record<string, unknown> | null;
}

function formatMoney(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const cur = currency ?? "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur }).format(
      cents / 100,
    );
  } catch {
    return `${(cents / 100).toFixed(2)} ${cur}`;
  }
}

function shortDate(iso: string): string {
  return format(new Date(iso), "dd/MM/yy HH:mm", { locale: ptBR });
}

export function CRMSidePanel({ conversation }: Props) {
  const contact = conversation?.contacts ?? null;
  const contactId = contact?.id ?? null;

  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [activities, setActivities] = useState<ActivityRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!contactId) {
      setLeads(null);
      setOrders(null);
      setActivities(null);
      return;
    }
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        // Via API (server lê o cookie httpOnly). O client do browser não
        // autentica no PostgREST, então RLS devolveria vazio.
        const res = await apiClient.get<{
          data: { leads: LeadRow[]; orders: OrderRow[]; activities: ActivityRow[] };
        }>(`/api/v1/contacts/${contactId}/crm-context`);
        if (cancelled) return;
        setLeads(res.data.leads ?? []);
        setOrders(res.data.orders ?? []);
        setActivities(res.data.activities ?? []);
      } catch {
        if (cancelled) return;
        setLeads([]);
        setOrders([]);
        setActivities([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  const tags = contact?.tags ?? [];
  const displayName =
    contact?.display_name?.trim() ||
    contact?.name?.trim() ||
    contact?.phone_number ||
    "—";

  const sectionsLoading = useMemo(
    () => loading || (leads === null && orders === null && activities === null),
    [loading, leads, orders, activities],
  );

  if (!conversation) {
    return (
      <aside className="flex h-full items-center justify-center border-l border-border p-4 text-center text-xs text-muted-foreground">
        Selecione uma conversa para ver detalhes do contato.
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto border-l border-border bg-background p-4">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contato
        </h3>
        <Card className="mt-2 space-y-2 p-3 text-sm">
          <div className="font-medium">{displayName}</div>
          {contact?.phone_number && (
            <div className="text-xs text-muted-foreground">{contact.phone_number}</div>
          )}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <Badge key={t} variant="secondary" className="h-4 px-1.5 text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
              <Tag size={12} className="mr-1" weight="regular" aria-hidden /> Tag
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
              <Users size={12} className="mr-1" weight="regular" aria-hidden /> Lead
            </Button>
            {contactId && (
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <Link href={`/app/contacts/${contactId}`}>
                  Ver contato
                  <ArrowRight size={12} className="ml-1" weight="regular" aria-hidden />
                </Link>
              </Button>
            )}
          </div>
        </Card>
      </section>

      <Separator />

      {(() => {
        const aiLead = leads?.find((l) => l.status === "open") ?? leads?.[0] ?? null;
        const cf = (aiLead?.custom_fields ?? {}) as Record<string, unknown>;
        const stage = Array.isArray(aiLead?.crm_stages)
          ? aiLead?.crm_stages[0]?.name
          : aiLead?.crm_stages?.name;
        const resumo = typeof cf["resumo"] === "string" ? (cf["resumo"] as string) : null;
        const score = cf["score"] != null ? Number(cf["score"]) : null;
        const fields = FIELD_ORDER.filter(
          (f) => cf[f.key] != null && String(cf[f.key]).trim() !== "",
        );
        const hasNote = Boolean(resumo || stage || Number.isFinite(score) || fields.length > 0);
        if (sectionsLoading) {
          return (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Nota da IA
              </h3>
              <Skeleton className="mt-2 h-20 w-full" />
            </section>
          );
        }
        if (!hasNote) return null;
        return (
          <>
            <section>
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Nota da IA
                </h3>
                <div className="flex items-center gap-1.5">
                  {stage && (
                    <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                      {stage}
                    </Badge>
                  )}
                  {Number.isFinite(score) && (
                    <span
                      className={
                        "text-[10px] font-semibold tabular-nums " +
                        ((score as number) >= 70
                          ? "text-green-600 dark:text-green-400"
                          : (score as number) >= 40
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground")
                      }
                    >
                      ★ {Math.round(score as number)}
                    </span>
                  )}
                </div>
              </div>
              <Card className="mt-2 space-y-2 p-3 text-xs">
                {resumo && <p className="leading-snug text-text">{resumo}</p>}
                {fields.length > 0 && (
                  <dl className="space-y-1">
                    {fields.map((f) => (
                      <div key={f.key} className="flex gap-1.5">
                        <dt className="shrink-0 text-muted-foreground">{f.label}:</dt>
                        <dd className="min-w-0 break-words">{String(cf[f.key])}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="pt-0.5 text-[10px] text-text-subtle">
                  Preenchido automaticamente pela IA a partir da conversa.
                </p>
              </Card>
            </section>
            <Separator />
          </>
        );
      })()}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Leads recentes
        </h3>
        {sectionsLoading ? (
          <Skeleton className="mt-2 h-14 w-full" />
        ) : leads && leads.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {leads.map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between rounded-md border border-border p-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{l.title}</div>
                  <div className="text-muted-foreground">
                    {l.status} · {formatMoney(l.value_cents, l.currency)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Sem leads.</p>
        )}
      </section>

      <Separator />

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pedidos recentes
        </h3>
        {sectionsLoading ? (
          <Skeleton className="mt-2 h-14 w-full" />
        ) : orders && orders.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {orders.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between rounded-md border border-border p-2 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1 truncate font-medium">
                    <Receipt size={11} weight="regular" aria-hidden />
                    {o.external_id ?? o.id.slice(0, 8)}
                  </div>
                  <div className="text-muted-foreground">
                    {o.status ?? "—"} · {formatMoney(o.total_cents, o.currency)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Sem pedidos.</p>
        )}
      </section>

      <Separator />

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Atividade
        </h3>
        {sectionsLoading ? (
          <Skeleton className="mt-2 h-14 w-full" />
        ) : activities && activities.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {activities.map((a) => (
              <li key={a.id} className="rounded-md border border-border p-2 text-xs">
                <div className="font-medium">{a.type}</div>
                <div className="text-muted-foreground">
                  {a.source_module} · {shortDate(a.performed_at)}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Sem atividade.</p>
        )}
      </section>
    </aside>
  );
}
