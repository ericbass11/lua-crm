import { describe, expect, it } from "vitest";

import { decidirEnvioDoPerfil, habilitarPerfilManagedInbound } from "./politica-inbound-only";

const PERFIL = { operation_profile: "managed_mvp_inbound" };

describe("política managed_mvp_inbound", () => {
  it("habilita o perfil sem apagar configurações da organização", () => {
    const original = {
      routing: { mode: "manual" },
      security: { mfa_required: true },
      operation_profile: "legado",
    };

    expect(habilitarPerfilManagedInbound(original)).toEqual({
      routing: { mode: "manual" },
      security: { mfa_required: true },
      operation_profile: "managed_mvp_inbound",
    });
    expect(original.operation_profile).toBe("legado");
  });

  it("degrada settings inválido para um objeto com o perfil", () => {
    expect(habilitarPerfilManagedInbound(null)).toEqual({
      operation_profile: "managed_mvp_inbound",
    });
  });

  it("não altera organizações sem o perfil", () => {
    expect(
      decidirEnvioDoPerfil({
        settings: {},
        actorType: "webhook_source",
        intent: { kind: "campaign" },
        isGroup: true,
      }),
    ).toEqual({ permitido: true, perfil: "padrao" });
  });

  it("permite resposta automática somente quando aponta para um inbound", () => {
    expect(
      decidirEnvioDoPerfil({
        settings: PERFIL,
        actorType: "ai_agent",
        intent: {
          kind: "inbound_reply",
          inboundMessageId: "11111111-1111-4111-8111-111111111111",
        },
        isGroup: false,
      }),
    ).toEqual({
      permitido: true,
      perfil: "managed_mvp_inbound",
      exigeComprovacaoDoInbound: "11111111-1111-4111-8111-111111111111",
    });

    expect(
      decidirEnvioDoPerfil({
        settings: PERFIL,
        actorType: "ai_agent",
        intent: { kind: "ad_hoc" },
        isGroup: false,
      }),
    ).toMatchObject({ permitido: false, motivo: "outbound_nao_permitido" });
  });

  it.each(["campaign", "followup", "ad_hoc", "system_outbound"] as const)(
    "bloqueia %s iniciado pelo sistema",
    (kind) => {
      expect(
        decidirEnvioDoPerfil({
          settings: PERFIL,
          actorType: "webhook_source",
          intent: { kind },
          isGroup: false,
        }),
      ).toMatchObject({ permitido: false, motivo: "outbound_nao_permitido" });
    },
  );

  it("permite a continuidade humana e o aviso de handoff", () => {
    expect(
      decidirEnvioDoPerfil({
        settings: PERFIL,
        actorType: "user",
        intent: { kind: "ad_hoc" },
        isGroup: false,
        hasInbound: true,
      }),
    ).toMatchObject({ permitido: true });

    expect(
      decidirEnvioDoPerfil({
        settings: PERFIL,
        actorType: "ai_agent",
        intent: { kind: "human_handoff" },
        isGroup: false,
        hasInbound: true,
      }),
    ).toMatchObject({ permitido: true });
  });

  it("bloqueia mensagem humana avulsa sem inbound anterior", () => {
    expect(
      decidirEnvioDoPerfil({
        settings: PERFIL,
        actorType: "user",
        intent: { kind: "ad_hoc" },
        isGroup: false,
        hasInbound: false,
      }),
    ).toMatchObject({ permitido: false, motivo: "outbound_nao_permitido" });
  });

  it("bloqueia grupos mesmo quando a intenção seria permitida", () => {
    expect(
      decidirEnvioDoPerfil({
        settings: PERFIL,
        actorType: "user",
        intent: { kind: "human_handoff" },
        isGroup: true,
      }),
    ).toMatchObject({ permitido: false, motivo: "grupos_nao_permitidos" });
  });
});
