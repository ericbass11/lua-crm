"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/browser";
import {
  sourcesQueryKey,
  useKnowledgeSources,
  useReindexSource,
  type SourceRow,
} from "@/hooks/ai/useKnowledgeSources";
import {
  KnowledgeSourceCard,
  type KnowledgeSourceType,
} from "@/components/ai/KnowledgeSourceCard";
import { FaqEditorDialog } from "@/components/ai/FaqEditorDialog";

interface Props {
  agentId: string;
  initialSources: SourceRow[];
}

const SLOTS: KnowledgeSourceType[] = ["faq", "policy", "conversations", "catalog"];

function canonicalType(t: string): KnowledgeSourceType | "other" {
  if (t === "faq") return "faq";
  if (t === "policy") return "policy";
  if (t === "conversation" || t === "conversations") return "conversations";
  if (t === "catalog" || t === "nuvemshop_catalog") return "catalog";
  return "other";
}

export function KnowledgeSourcesClient({ agentId, initialSources }: Props) {
  const qc = useQueryClient();
  const { data: sources } = useKnowledgeSources(agentId, { initialData: initialSources });
  const reindex = useReindexSource(agentId);
  const [faqOpen, setFaqOpen] = useState(false);

  // Realtime subscription.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`ai-knowledge-sources-${agentId}`)
      .on(
        "postgres_changes" as never,
        {
          event: "*",
          schema: "public",
          table: "ai_knowledge_sources",
          filter: `agent_id=eq.${agentId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: sourcesQueryKey(agentId) });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [agentId, qc]);

  const list = sources ?? [];

  const bySlot: Record<KnowledgeSourceType, SourceRow | undefined> = {
    faq: undefined,
    policy: undefined,
    conversations: undefined,
    catalog: undefined,
  };

  for (const s of list) {
    const t = canonicalType(s.source_type);
    if (t !== "other" && !bySlot[t]) {
      bySlot[t] = s;
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SLOTS.map((slot) => {
          const source = bySlot[slot];
          const isReindexing =
            reindex.isPending && reindex.variables === source?.id;
          return (
            <KnowledgeSourceCard
              key={slot}
              type={slot}
              source={source ?? null}
              isReindexing={isReindexing}
              onReindex={source ? () => reindex.mutate(source.id) : undefined}
              onConfigure={slot === "faq" ? () => setFaqOpen(true) : undefined}
            />
          );
        })}
      </div>

      <FaqEditorDialog
        agentId={agentId}
        sourceId={bySlot.faq?.id ?? null}
        open={faqOpen}
        onOpenChange={setFaqOpen}
        onSaved={() => qc.invalidateQueries({ queryKey: sourcesQueryKey(agentId) })}
      />
    </>
  );
}
