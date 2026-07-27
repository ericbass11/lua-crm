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
  alta: "bg-error-bg text-error-fg",
  media: "bg-warning-bg text-warning-fg",
  baixa: "bg-info-bg text-info-fg",
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
    score >= 70 ? "text-success-fg" : score >= 40 ? "text-warning-fg" : "text-text-subtle";

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
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", URGENCY_STYLE[urg])}>
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
            "group rounded-xl border border-border bg-surface p-4 shadow-sm transition",
            "hover:border-border-strong hover:shadow-md",
            snapshot.isDragging && "rotate-1 shadow-lg ring-1 ring-accent/40",
            isSelected && "ring-2 ring-accent",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-text">
              {lead.title}
            </h3>
            <KanbanCardActions lead={lead} pipelineId={pipelineId} />
          </div>

          {(contactName || contactPhone) && (
            <div className="mt-2.5 flex items-center gap-2.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
                aria-hidden
              >
                {(contactName ?? lead.title).charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 space-y-0.5">
                {contactName && (
                  <p className="truncate text-xs font-medium text-text">{contactName}</p>
                )}
                {contactPhone && (
                  <p className="truncate text-xs tabular-nums text-text-subtle">{contactPhone}</p>
                )}
              </div>
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
