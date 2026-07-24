/**
 * Tests for lib/phone.ts — normalização E.164 do envio ativo.
 *
 * Cobre: máscara BR, DDI explícito (+55), já-E.164, "55" ambíguo (só é DDI
 * quando o comprimento bate), e rejeição de entradas curtas/vazias.
 */
import { describe, expect, it } from "vitest";

import { normalizeToE164 } from "./phone";

describe("normalizeToE164", () => {
  it("normaliza número BR com máscara (sem DDI) prefixando 55", () => {
    expect(normalizeToE164("(11) 99999-9999")).toEqual({
      e164: "+5511999999999",
      chatId: "5511999999999@c.us",
    });
  });

  it("aceita DDI explícito com +", () => {
    expect(normalizeToE164("+55 11 99999-9999")).toEqual({
      e164: "+5511999999999",
      chatId: "5511999999999@c.us",
    });
  });

  it("trata número já em E.164 sem duplicar o DDI", () => {
    expect(normalizeToE164("5511999999999")).toEqual({
      e164: "+5511999999999",
      chatId: "5511999999999@c.us",
    });
  });

  it("não confunde DDD 55 (fixo curto) com DDI", () => {
    // 10 dígitos, começa com 55 mas não tem comprimento de BR+DDI → prefixa 55.
    expect(normalizeToE164("5533334444")).toEqual({
      e164: "+555533334444",
      chatId: "555533334444@c.us",
    });
  });

  it("preserva DDI estrangeiro quando vem com +", () => {
    expect(normalizeToE164("+1 415 555 2671")).toEqual({
      e164: "+14155552671",
      chatId: "14155552671@c.us",
    });
  });

  it("rejeita entrada vazia ou curta demais", () => {
    expect(normalizeToE164("")).toBeNull();
    expect(normalizeToE164("   ")).toBeNull();
    expect(normalizeToE164("12345")).toBeNull();
  });
});
