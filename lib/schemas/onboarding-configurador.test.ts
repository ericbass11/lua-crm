import { describe, expect, it } from "vitest";

import { iniciarConfigurador } from "@/lib/onboarding/configurador";
import { onboardingStateSchema } from "./onboarding";

describe("estado persistido do configurador de atendimento", () => {
  it("aceita uma sessão estruturada e conserva a pergunta atual", () => {
    const session = iniciarConfigurador();
    const parsed = onboardingStateSchema.parse({
      configurador_atendimento: {
        session,
        updated_at: "2026-10-01T22:00:00.000Z",
      },
    });

    expect(parsed.configurador_atendimento?.session.pergunta_atual?.id).toBe(
      "nome_do_negocio",
    );
  });

  it("recusa uma sessão sem AgentSpec versionada", () => {
    expect(() =>
      onboardingStateSchema.parse({
        configurador_atendimento: {
          session: { status: "coletando", respostas: {}, pergunta_atual: null },
          updated_at: "2026-10-01T22:00:00.000Z",
        },
      }),
    ).toThrow();
  });
});
