import { agentSpecSchemaV1, type AgentSpecV1 } from "./tipos";

export interface ProntidaoAgentSpec {
  ready: boolean;
  missing: string[];
}

export function avaliarProntidao(spec: AgentSpecV1): ProntidaoAgentSpec {
  const missing: string[] = [];
  const estrutura = agentSpecSchemaV1.safeParse(spec);
  if (!estrutura.success) return { ready: false, missing: ["schema"] };

  if (!spec.business.name) missing.push("business.name");
  if (!spec.business.description) missing.push("business.description");
  if (!spec.business.service_area) missing.push("business.service_area");
  if (!spec.business.opening_hours) missing.push("business.opening_hours");
  if (spec.services.length === 0) missing.push("services");
  if (spec.qualification.length === 0) missing.push("qualification");
  if (spec.handoff.triggers.length === 0) missing.push("handoff.triggers");
  if (spec.handoff.summary_fields.length === 0) missing.push("handoff.summary_fields");
  if (spec.forbidden_topics.length === 0) missing.push("forbidden_topics");
  if (!spec.tone) missing.push("tone");

  return { ready: missing.length === 0, missing };
}
