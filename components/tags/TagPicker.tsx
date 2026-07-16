"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";

interface TagDef {
  id: string;
  name: string;
  color: string;
}

const COLOR_DOT: Record<string, string> = {
  gray: "#9ca3af",
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#a855f7",
};

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
}

/**
 * Seletor de tags do catálogo da org (tag_definitions) com criação inline:
 * a tag criada aqui entra no catálogo (Configurações → Tags) e fica
 * disponível dali em diante — inclusive para a IA.
 */
export function TagPicker({ value, onChange }: Props) {
  const [catalog, setCatalog] = useState<TagDef[]>([]);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiClient.get<{ data: TagDef[] }>("/api/v1/tags");
        setCatalog(res.data);
      } catch {
        /* catálogo indisponível — seleção manual continua funcionando */
      }
    })();
  }, []);

  const has = (name: string) => value.some((t) => t.toLowerCase() === name.toLowerCase());
  const add = (name: string) => {
    if (!has(name)) onChange([...value, name]);
  };
  const remove = (name: string) => onChange(value.filter((t) => t.toLowerCase() !== name.toLowerCase()));

  const createAndAdd = async () => {
    const name = draft.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await apiClient.post<{ data: TagDef }>("/api/v1/tags", {
        name,
        description: "",
        color: "gray",
      });
      setCatalog((c) => [...c, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      add(res.data.name);
      setDraft("");
      toast.success(`Tag "${res.data.name}" criada e adicionada ao catálogo.`);
    } catch (err) {
      // 409 = já existe no catálogo → só seleciona
      if (err instanceof ApiError && err.status === 409) {
        add(name);
        setDraft("");
      } else {
        toast.error(err instanceof ApiError ? err.message : "Não foi possível criar a tag.");
      }
    } finally {
      setCreating(false);
    }
  };

  const available = catalog.filter((t) => !has(t.name));

  return (
    <div className="space-y-2.5">
      <div className="rounded-md border border-dashed p-2">
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Selecionadas neste lead
        </p>
        {value.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma — clique numa tag abaixo para adicionar.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {value.map((t) => {
              const def = catalog.find((c) => c.name.toLowerCase() === t.toLowerCase());
              return (
                <Badge key={t} variant="secondary" className="gap-1.5 pr-1">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: COLOR_DOT[def?.color ?? "gray"] }}
                  />
                  {t}
                  <button
                    type="button"
                    aria-label={`Remover tag ${t}`}
                    className="ml-0.5 rounded px-1 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => remove(t)}
                  >
                    ×
                  </button>
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      {available.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Catálogo — clique para adicionar
          </p>
          <div className="flex flex-wrap gap-1.5">
            {available.map((t) => (
              <button key={t.id} type="button" onClick={() => add(t.name)}>
                <Badge
                  variant="outline"
                  className="cursor-pointer gap-1.5 hover:border-border-strong"
                >
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ backgroundColor: COLOR_DOT[t.color] ?? COLOR_DOT.gray }}
                  />
                  + {t.name}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="nova tag…"
          maxLength={40}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void createAndAdd();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={creating || !draft.trim()}
          onClick={() => void createAndAdd()}
        >
          {creating ? "Criando…" : "Criar tag"}
        </Button>
      </div>
    </div>
  );
}
