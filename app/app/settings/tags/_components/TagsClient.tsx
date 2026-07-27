"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

interface TagDef {
  id: string;
  name: string;
  description: string;
  color: string;
}

const COLORS = ["gray", "red", "orange", "yellow", "green", "blue", "purple"] as const;
const COLOR_LABEL: Record<string, string> = {
  gray: "Cinza",
  red: "Vermelho",
  orange: "Laranja",
  yellow: "Amarelo",
  green: "Verde",
  blue: "Azul",
  purple: "Roxo",
};
const COLOR_DOT: Record<string, string> = {
  gray: "#9ca3af",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#a855f7",
};

export function TagsClient() {
  const [tags, setTags] = useState<TagDef[] | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>("gray");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await apiClient.get<{ data: TagDef[] }>("/api/v1/tags");
      setTags(res.data);
    } catch (err) {
      showApiError(err);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiClient.post("/api/v1/tags", { name: name.trim(), description: description.trim(), color });
      toast.success(`Tag "${name.trim()}" criada.`);
      setName("");
      setDescription("");
      setColor("gray");
      await load();
    } catch (err) {
      showApiError(err);
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (tag: TagDef) => {
    if (!confirm(`Remover a tag "${tag.name}"? Ela será retirada de todas as conversas.`)) return;
    try {
      await apiClient.delete(`/api/v1/tags/${tag.id}`);
      toast.success(`Tag "${tag.name}" removida.`);
      await load();
    } catch (err) {
      showApiError(err);
    }
  };

  return (
    <div className="grid max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <form onSubmit={onCreate} className="space-y-4">
          <h2 className="text-base font-semibold">Nova tag</h2>
          <div className="space-y-2">
            <Label htmlFor="tag-name">Nome</Label>
            <Input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: orçamento"
              maxLength={40}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tag-desc">Quando a IA deve aplicar</Label>
            <Input
              id="tag-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ex: cliente perguntou preço, valores ou pediu orçamento"
              maxLength={300}
            />
            <p className="text-xs text-text-muted">
              Este texto vai direto para a IA — quanto mais específico, melhor a precisão.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tag-color">Cor</Label>
            <Select value={color} onValueChange={setColor}>
              <SelectTrigger id="tag-color">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLORS.map((c) => (
                  <SelectItem key={c} value={c}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block size-2.5 rounded-full"
                        style={{ backgroundColor: COLOR_DOT[c] }}
                      />
                      {COLOR_LABEL[c]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? "Criando…" : "Criar tag"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="text-base font-semibold">
          Tags cadastradas {tags ? `(${tags.length})` : ""}
        </h2>
        {!tags ? (
          <p className="text-sm text-text-muted">Carregando…</p>
        ) : tags.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nenhuma tag ainda. Crie a primeira ao lado — a IA passa a usá-la imediatamente.
          </p>
        ) : (
          <ul className="space-y-2">
            {tags.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-2 rounded-md border p-3">
                <div className="min-w-0">
                  <Badge variant="secondary" className="gap-1.5">
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: COLOR_DOT[t.color] ?? COLOR_DOT.gray }}
                    />
                    {t.name}
                  </Badge>
                  {t.description && (
                    <p className="mt-1 text-xs text-text-muted">{t.description}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 text-destructive"
                  onClick={() => void onDelete(t)}
                >
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
