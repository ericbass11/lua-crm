"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Plus, Trash } from "@/lib/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createPipeline } from "@/app/actions/settings/createPipeline";
import { deletePipeline } from "@/app/actions/settings/deletePipeline";

export interface PipelineListItem {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
  description: string | null;
  lead_count: number;
}

export function KanbanPipelinesClient({
  pipelines,
  canManage,
}: {
  pipelines: PipelineListItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  const [toDelete, setToDelete] = useState<PipelineListItem | null>(null);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Pipelines</h1>
        </div>
        {canManage && (
          <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
            <Plus size={16} weight="bold" aria-hidden />
            Novo pipeline
          </Button>
        )}
      </header>

      {pipelines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p>Nenhum pipeline ainda.</p>
          {canManage && (
            <Button onClick={() => setNewOpen(true)} className="gap-1.5">
              <Plus size={16} weight="bold" aria-hidden />
              Criar o primeiro pipeline
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {pipelines.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-md border border-border bg-surface transition-colors hover:border-border-strong"
            >
              <Link href={`/app/pipelines/${p.id}`} className="flex flex-1 items-center justify-between px-4 py-3">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{p.name}</span>
                    {p.is_default && (
                      <Badge variant="secondary" className="text-[10px]">
                        Default
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {p.lead_count} {p.lead_count === 1 ? "lead" : "leads"}
                    </span>
                  </div>
                  {p.description && (
                    <span className="text-xs text-muted-foreground">{p.description}</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">/{p.slug}</span>
              </Link>
              {canManage && (
                <div className="pr-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-error-fg"
                    aria-label={`Excluir ${p.name}`}
                    disabled={p.lead_count > 0}
                    title={
                      p.lead_count > 0
                        ? `Não é possível excluir: ${p.lead_count} lead(s) neste pipeline`
                        : "Excluir pipeline"
                    }
                    onClick={() => setToDelete(p)}
                  >
                    <Trash size={16} aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <NewPipelineDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(id) => router.push(`/app/pipelines/${id}`)}
      />
      <DeletePipelineDialog
        pipeline={toDelete}
        onOpenChange={(v) => !v && setToDelete(null)}
        onDeleted={() => {
          setToDelete(null);
          router.refresh();
        }}
      />
    </div>
  );
}

function NewPipelineDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    if (name.trim().length < 2) return;
    start(async () => {
      const res = await createPipeline({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      if (res.ok) {
        toast.success("Pipeline criado com as etapas padrão.");
        setName("");
        setDescription("");
        onOpenChange(false);
        onCreated(res.id);
      } else {
        toast.error(`Não foi possível criar: ${res.error}`);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo pipeline</DialogTitle>
          <DialogDescription>
            Cria um funil com as etapas padrão (Novo · Em andamento · Ganhou · Perdido). Você ajusta
            os critérios de cada etapa em Configurações → Pipelines.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="np-name">Nome</Label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Vendas B2B"
              autoFocus
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="np-desc">Descrição (opcional)</Label>
            <Textarea
              id="np-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={280}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={pending || name.trim().length < 2}>
            {pending ? "Criando…" : "Criar pipeline"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeletePipelineDialog({
  pipeline,
  onOpenChange,
  onDeleted,
}: {
  pipeline: PipelineListItem | null;
  onOpenChange: (v: boolean) => void;
  onDeleted: () => void;
}) {
  const [pending, start] = useTransition();

  function confirm() {
    if (!pipeline) return;
    start(async () => {
      const res = await deletePipeline(pipeline.id);
      if (res.ok) {
        toast.success("Pipeline excluído.");
        onDeleted();
      } else if (res.error === "has_leads") {
        toast.error(
          `Não é possível excluir: há ${res.lead_count ?? ""} lead(s) neste pipeline. Mova ou remova os leads primeiro.`,
        );
      } else {
        toast.error(`Falha ao excluir: ${res.error}`);
      }
    });
  }

  return (
    <AlertDialog open={!!pipeline} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir “{pipeline?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            As etapas deste pipeline serão removidas. Esta ação não pode ser desfeita. Só é possível
            excluir pipelines sem nenhum lead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              confirm();
            }}
            disabled={pending}
          >
            {pending ? "Excluindo…" : "Excluir"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
