"use client";
import { Draggable } from "@hello-pangea/dnd";
import { useState, type MouseEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Lead } from "@/lib/types/leads";
import { KanbanCardActions } from "./KanbanCardActions";
import { EditLeadDialog } from "./EditLeadDialog";

interface KanbanCardProps {
  lead: Lead;
  index: number;
  pipelineId: string;
  isSelected?: boolean;
  onSelect?: (leadId: string, additive: boolean) => void;
}

const URGENCY_STYLE: Record<string, string> = {
  alta: "bg-red-500/15 text-red-600 dark:text-red-400",
  media: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  baixa: "bg-slate-500/15 text-slate-600 dark:text-slate-400",
};

/** Sinais estratégicos mantidos pela IA: score (0-100) + urgência. */
function LeadSignals({ customFields }: { customFields: Record<string, unknown> | null }) {
  const cf = customFields ?? {};
  const rawScore = cf["score"];
  const score = typeof rawScore === "number" ? rawScore : Number(rawScore);
  const hasScore = Number.isFinite(score);
  const urg = typeof cf["urgencia"] === "string" ? (cf["urgencia"] as string).toLowerCase() : "";
  const hasUrg = urg === "alta" || urg === "media" || urg === "baixa";
  if (!hasScore && !hasUrg) return null;

  const scoreColor =
    score >= 70 ? "text-green-600 dark:text-green-400" : score >= 40 ? "text-amber-600 dark:text-amber-400" : "text-slate-500";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {hasScore && (
        <span
          className={cn("text-[10px] font-semibold tabular-nums", scoreColor)}
          title="Score do lead (0-100), mantido pela IA"
        >
          ★ {Math.round(score)}
        </span>
      )}
      {hasUrg && (
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", URGENCY_STYLE[urg])}>
          {urg === "media" ? "média" : urg}
        </span>
      )}
    </div>
  );
}

export function KanbanCard({
  lead,
  index,
  pipelineId,
  isSelected,
  onSelect,
}: KanbanCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const contactName = lead.contact?.display_name || lead.contact?.name || null;
  const contactPhone = lead.contact?.phone_number || null;

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!onSelect) return;
    const additive = e.metaKey || e.ctrlKey;
    onSelect(lead.id, additive);
  };

  return (
    <Draggable draggableId={lead.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={handleClick}
          onDoubleClick={() => setEditOpen(true)}
          className={cn(
            "group rounded-md border border-border bg-surface p-3 shadow-xs transition-colors",
            "hover:border-border-strong",
            snapshot.isDragging && "rotate-1 shadow-md ring-1 ring-accent/40",
            isSelected && "ring-2 ring-accent",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-medium leading-snug text-text">
              {lead.title}
            </h3>
            <KanbanCardActions lead={lead} pipelineId={pipelineId} />
          </div>

          {(contactName || contactPhone) && (
            <div className="mt-1.5 space-y-0.5">
              {contactName && (
                <p className="truncate text-xs font-medium text-text">{contactName}</p>
              )}
              {contactPhone && (
                <p className="truncate text-[11px] tabular-nums text-text-muted">{contactPhone}</p>
              )}
            </div>
          )}

          {lead.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {lead.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
              {lead.tags.length > 3 && (
                <span className="text-[10px] text-text-muted">
                  +{lead.tags.length - 3}
                </span>
              )}
            </div>
          )}

          <LeadSignals customFields={lead.custom_fields} />

          <EditLeadDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            lead={lead}
            pipelineId={pipelineId}
          />
        </div>
      )}
    </Draggable>
  );
}
