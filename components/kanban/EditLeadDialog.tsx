"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
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
import { TagPicker } from "@/components/tags/TagPicker";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useEditLead } from "@/hooks/kanban/useUpdateLead";
import type { Lead } from "@/lib/types/leads";
import { updateLeadSchema, type UpdateLeadInput } from "@/lib/schemas/leads";

interface FormShape {
  title: string;
  description: string;
  valueReais: string;
  tagsRaw: string;
  expected_close_date: string;
}

interface FieldDef {
  key: string;
  label: string;
  type: string;
  options?: Array<{ value: string; label: string }>;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  pipelineId: string;
}

function centsToReais(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function EditLeadDialog({ open, onOpenChange, lead, pipelineId }: Props) {
  const edit = useEditLead(pipelineId);

  // Campos estratégicos declarados no pipeline (Fase 2). Editáveis; a IA também
  // os preenche. Estado local espelhando lead.custom_fields.
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const cf = (lead.custom_fields ?? {}) as Record<string, unknown>;
    setFieldValues(
      Object.fromEntries(Object.entries(cf).map(([k, v]) => [k, v == null ? "" : String(v)])),
    );
    void (async () => {
      try {
        const res = await apiClient.get<{ data: { settings?: { fields?: FieldDef[] } } }>(
          `/api/v1/pipelines/${pipelineId}`,
        );
        setFieldDefs(res.data?.settings?.fields ?? []);
      } catch {
        setFieldDefs([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead.id, pipelineId]);

  const form = useForm<FormShape>({
    defaultValues: {
      title: lead.title,
      description: lead.description ?? "",
      valueReais: centsToReais(lead.value_cents),
      tagsRaw: (lead.tags ?? []).join(", "),
      expected_close_date: lead.expected_close_date ?? "",
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        title: lead.title,
        description: lead.description ?? "",
        valueReais: centsToReais(lead.value_cents),
        tagsRaw: (lead.tags ?? []).join(", "),
        expected_close_date: lead.expected_close_date ?? "",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead.id]);

  async function onSubmit(values: FormShape) {
    const tags = values.tagsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const reais = values.valueReais.trim();
    let valueCents: number | null = null;
    if (reais.length > 0) {
      const normalized = reais.replace(/\./g, "").replace(",", ".");
      const n = Number(normalized);
      if (!Number.isFinite(n) || n < 0) {
        form.setError("valueReais", { message: "Valor inválido" });
        return;
      }
      valueCents = Math.round(n * 100);
    }

    // Campos estratégicos: converte por tipo declarado; vazio → null (remove).
    const customFields: Record<string, string | number | boolean | null> = {};
    for (const def of fieldDefs) {
      const raw = (fieldValues[def.key] ?? "").trim();
      if (raw === "") {
        customFields[def.key] = null;
      } else if (def.type === "number") {
        const n = Number(raw.replace(",", "."));
        customFields[def.key] = Number.isFinite(n) ? n : raw;
      } else if (def.type === "boolean") {
        customFields[def.key] = raw === "true" || raw === "sim" || raw === "1";
      } else {
        customFields[def.key] = raw;
      }
    }

    const patch: Record<string, unknown> = {
      title: values.title.trim(),
      description: values.description.trim() ? values.description.trim() : null,
      value_cents: valueCents,
      tags,
      expected_close_date: values.expected_close_date || null,
      ...(fieldDefs.length > 0 ? { custom_fields: customFields } : {}),
    };

    const parsed = updateLeadSchema.safeParse(patch);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      toast.error(first?.message ?? "Dados inválidos");
      return;
    }

    try {
      await edit.mutateAsync({
        leadId: lead.id,
        patch: parsed.data as UpdateLeadInput,
      });
      toast.success("Lead atualizado");
      onOpenChange(false);
    } catch {
      // toast already shown
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar lead</DialogTitle>
          <DialogDescription>
            Atualize os campos. Mover de etapa ou marcar ganho/perdido tem opções
            próprias.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Título</Label>
            <Input
              id="title"
              {...form.register("title", { required: true, minLength: 2 })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea id="description" rows={3} {...form.register("description")} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="valueReais">Valor (R$)</Label>
              <Input
                id="valueReais"
                inputMode="decimal"
                placeholder="0,00"
                {...form.register("valueReais")}
              />
              {form.formState.errors.valueReais && (
                <p className="text-xs text-error-fg">
                  {form.formState.errors.valueReais.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="expected_close_date">Fechamento previsto</Label>
              <Input
                id="expected_close_date"
                type="date"
                {...form.register("expected_close_date")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <TagPicker
              value={form
                .watch("tagsRaw")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)}
              onChange={(tags) => form.setValue("tagsRaw", tags.join(", "), { shouldDirty: true })}
            />
          </div>

          {fieldDefs.length > 0 && (
            <div className="space-y-3 border-t pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Campos estratégicos <span className="normal-case">(a IA também preenche)</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {fieldDefs.map((def) => {
                  const val = fieldValues[def.key] ?? "";
                  const set = (v: string) => setFieldValues((s) => ({ ...s, [def.key]: v }));
                  return (
                    <div
                      key={def.key}
                      className={cn("space-y-1", def.type === "textarea" && "sm:col-span-2")}
                    >
                      <Label className="text-xs">{def.label}</Label>
                      {def.type === "textarea" ? (
                        <Textarea rows={2} value={val} onChange={(e) => set(e.target.value)} />
                      ) : def.type === "select" && def.options ? (
                        <select
                          value={val}
                          onChange={(e) => set(e.target.value)}
                          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                        >
                          <option value="">—</option>
                          {def.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : def.type === "boolean" ? (
                        <select
                          value={val}
                          onChange={(e) => set(e.target.value)}
                          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                        >
                          <option value="">—</option>
                          <option value="true">Sim</option>
                          <option value="false">Não</option>
                        </select>
                      ) : (
                        <Input
                          type={def.type === "number" ? "number" : "text"}
                          value={val}
                          onChange={(e) => set(e.target.value)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={edit.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={edit.isPending}>
              {edit.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
