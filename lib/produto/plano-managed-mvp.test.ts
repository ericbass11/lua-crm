import { describe, expect, it } from "vitest";

import { PLANOS_COMERCIAIS, PLANO_MANAGED_MVP } from "./plano-managed-mvp";

describe("plano comercial do MVP gerenciado", () => {
  it("expõe um único plano, sem ilimitado enganoso e sem disparos", () => {
    expect(PLANOS_COMERCIAIS).toHaveLength(1);
    expect(PLANO_MANAGED_MVP.preco_mensal_centavos).toBe(19_700);
    expect(PLANO_MANAGED_MVP.respostas_ia_incluidas).toBe(2_000);
    expect(PLANO_MANAGED_MVP.permite_disparos).toBe(false);
    expect(PLANO_MANAGED_MVP.descricao).not.toMatch(/ilimitad/i);
  });
});
