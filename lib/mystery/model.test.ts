import { describe, expect, it } from "vitest";

import { buildProviderModel } from "./model";

describe("buildProviderModel do Cliente Oculto", () => {
  it.each(["anthropic", "openai", "google", "openrouter", "deepseek"])(
    "aceita o provedor publicado %s",
    (provider) => {
      expect(() => buildProviderModel(provider, "chave-de-teste", "modelo-de-teste")).not.toThrow();
    },
  );

  it("recusa provedor fora da matriz", () => {
    expect(() => buildProviderModel("desconhecido", "chave", "modelo")).toThrow(
      "unsupported_provider:desconhecido",
    );
  });
});
