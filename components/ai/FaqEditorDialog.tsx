"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

interface QA {
  question: string;
  answer: string;
}

interface Props {
  agentId: string;
  /** Quando fornecido, o editor edita a FAQ existente (PATCH) e pré-carrega os itens. */
  sourceId?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}

const EMPTY: QA[] = [{ question: "", answer: "" }];

export function FaqEditorDialog({ agentId, sourceId, open, onOpenChange, onSaved }: Props) {
  const [name, setName] = useState("FAQ");
  const [items, setItems] = useState<QA[]>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const isEditing = Boolean(sourceId);

  // Ao abrir com uma FAQ existente, carrega os itens atuais para edição.
  useEffect(() => {
    if (!open) return;
    if (!sourceId) {
      setName("FAQ");
      setItems(EMPTY);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiClient
      .get<{
        data: {
          source: { name: string | null } | null;
          items: Array<{ question: string; answer: string }>;
        };
      }>(`/api/v1/ai/knowledge/sources/${sourceId}`)
      .then((resp) => {
        if (cancelled) return;
        const loaded = resp.data.items ?? [];
        setName(resp.data.source?.name || "FAQ");
        setItems(loaded.length > 0 ? loaded.map((it) => ({ question: it.question, answer: it.answer })) : EMPTY);
      })
      .catch((err) => {
        if (!cancelled) showApiError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sourceId]);

  const setItem = (i: number, patch: Partial<QA>) =>
    setItems((arr) => arr.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  const onSave = async () => {
    const clean = items
      .map((it) => ({ question: it.question.trim(), answer: it.answer.trim() }))
      .filter((it) => it.question && it.answer);
    if (clean.length === 0) {
      toast.error("Adicione ao menos uma pergunta com resposta.");
      return;
    }
    setSaving(true);
    try {
      const payloadItems = clean.map((it) => ({
        question: it.question,
        answer: it.answer,
        tags: [],
        locale: "pt-BR",
      }));

      if (sourceId) {
        // Edita a FAQ existente — o PATCH substitui os itens e re-emite o evento de indexação.
        await apiClient.patch(`/api/v1/ai/knowledge/sources/${sourceId}`, {
          name: name.trim() || "FAQ",
          items: payloadItems,
        });
        toast.success(`FAQ atualizada com ${clean.length} pergunta(s). Indexando…`);
      } else {
        await apiClient.post("/api/v1/ai/knowledge/sources", {
          agent_id: agentId,
          source_type: "faq",
          name: name.trim() || "FAQ",
          items: payloadItems,
        });
        toast.success(`FAQ criada com ${clean.length} pergunta(s). Indexando…`);
      }

      onOpenChange(false);
      onSaved();
    } catch (err) {
      showApiError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Base de conhecimento — FAQ</DialogTitle>
          <DialogDescription>
            Cadastre perguntas e respostas do seu negócio. A IA passa a responder ancorada nelas
            (é indexado automaticamente após salvar).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Carregando itens…</div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="faq-name">Nome da fonte</Label>
              <Input id="faq-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>

            {items.map((it, i) => (
              <div key={i} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Pergunta {i + 1}</span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      className="text-xs text-destructive"
                      onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}
                    >
                      Remover
                    </button>
                  )}
                </div>
                <Input
                  value={it.question}
                  onChange={(e) => setItem(i, { question: e.target.value })}
                  placeholder="Ex.: Quanto custa um site?"
                />
                <Textarea
                  rows={2}
                  value={it.answer}
                  onChange={(e) => setItem(i, { answer: e.target.value })}
                  placeholder="Ex.: A partir de R$X, inclui Y e Z, entrega em N dias."
                />
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems((arr) => [...arr, { question: "", answer: "" }])}
            >
              + Adicionar pergunta
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving || loading}>
            {saving ? "Salvando…" : isEditing ? "Salvar alterações e reindexar" : "Salvar e indexar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
