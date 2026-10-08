import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  marcarTesteFeito: vi.fn(),
  pularTeste: vi.fn(),
}));

vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/app/actions/onboarding/marcarTeste", () => actions);

import { TestarClient } from "./_client";

describe("sandbox do onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("executa e mostra a resposta da versão ainda em rascunho", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                status: "ok",
                run_id: "55555555-5555-4555-8555-555555555555",
                final_text: "Posso coletar seu bairro?",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    render(
      <TestarClient
        nome="Clima"
        agenteId="33333333-3333-4333-8333-333333333333"
        versaoId="44444444-4444-4444-8444-444444444444"
        emRascunho
      />,
    );

    expect(screen.getByText(/ensaio do rascunho/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mandar mensagem" }));

    expect(await screen.findByText("Posso coletar seu bairro?")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await waitFor(() =>
      expect(actions.marcarTesteFeito).toHaveBeenCalledWith({
        runId: "55555555-5555-4555-8555-555555555555",
        agentId: "33333333-3333-4333-8333-333333333333",
        versionId: "44444444-4444-4444-8444-444444444444",
      }),
    );
  });
});
