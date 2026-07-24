/**
 * Etapas do funil de prospecção do Cliente Oculto (vender o Agente de IA à
 * empresa auditada). Compartilhado entre server (validação) e client (kanban).
 */
export const MYSTERY_STAGES = [
  { key: "auditado", label: "Auditado", kind: "active" },
  { key: "qualificado", label: "Qualificado", kind: "active" },
  { key: "contato", label: "Contato", kind: "active" },
  { key: "proposta", label: "Proposta", kind: "active" },
  { key: "negociacao", label: "Negociação", kind: "active" },
  { key: "fechado", label: "Fechado", kind: "won" },
  { key: "perdido", label: "Perdido", kind: "lost" },
] as const;

export type MysteryStage = (typeof MYSTERY_STAGES)[number]["key"];

export const MYSTERY_STAGE_KEYS: MysteryStage[] = MYSTERY_STAGES.map((s) => s.key);

export function isMysteryStage(v: string): v is MysteryStage {
  return (MYSTERY_STAGE_KEYS as string[]).includes(v);
}

export function stageLabel(key: string): string {
  return MYSTERY_STAGES.find((s) => s.key === key)?.label ?? key;
}
