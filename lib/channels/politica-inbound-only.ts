export const PERFIL_MANAGED_MVP_INBOUND = "managed_mvp_inbound" as const;

export type IntencaoDeEnvio =
  | { kind: "inbound_reply"; inboundMessageId: string }
  | { kind: "human_handoff" }
  | { kind: "campaign" }
  | { kind: "followup" }
  | { kind: "ad_hoc" }
  | { kind: "system_outbound" };

type DecisaoDeEnvio =
  | { permitido: true; perfil: "padrao" }
  | {
      permitido: true;
      perfil: typeof PERFIL_MANAGED_MVP_INBOUND;
      exigeComprovacaoDoInbound?: string;
    }
  | {
      permitido: false;
      perfil: typeof PERFIL_MANAGED_MVP_INBOUND;
      motivo: "grupos_nao_permitidos" | "outbound_nao_permitido";
    };

function perfilDaOrganizacao(settings: unknown): string | null {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const perfil = (settings as Record<string, unknown>).operation_profile;
  return typeof perfil === "string" ? perfil : null;
}

/** Merge imutável usado pelo onboarding ao ativar o produto inbound-only. */
export function habilitarPerfilManagedInbound(settings: unknown): Record<string, unknown> {
  const atual =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  return { ...atual, operation_profile: PERFIL_MANAGED_MVP_INBOUND };
}

/**
 * Política pura do produto inbound-only.
 *
 * A identidade do transporte não participa: esta decisão vale antes de qualquer
 * adapter de canal. A intenção também vem do contexto interno confiável do
 * chamador, nunca de metadata/body público.
 */
export function decidirEnvioDoPerfil(input: {
  settings: unknown;
  actorType: "user" | "ai_agent" | "api_token" | "webhook_source";
  intent?: IntencaoDeEnvio;
  isGroup: boolean;
  hasInbound?: boolean;
}): DecisaoDeEnvio {
  if (perfilDaOrganizacao(input.settings) !== PERFIL_MANAGED_MVP_INBOUND) {
    return { permitido: true, perfil: "padrao" };
  }

  if (input.isGroup) {
    return {
      permitido: false,
      perfil: PERFIL_MANAGED_MVP_INBOUND,
      motivo: "grupos_nao_permitidos",
    };
  }

  if (
    (input.actorType === "user" || input.intent?.kind === "human_handoff") &&
    input.hasInbound === true
  ) {
    return { permitido: true, perfil: PERFIL_MANAGED_MVP_INBOUND };
  }

  if (input.intent?.kind === "inbound_reply") {
    return {
      permitido: true,
      perfil: PERFIL_MANAGED_MVP_INBOUND,
      exigeComprovacaoDoInbound: input.intent.inboundMessageId,
    };
  }

  return {
    permitido: false,
    perfil: PERFIL_MANAGED_MVP_INBOUND,
    motivo: "outbound_nao_permitido",
  };
}
