import { describe, expect, it } from "vitest";

import {
  RISCO_WHATSAPP_VERSAO,
  aceiteDoRiscoWhatsappSchema,
  declaracaoDoRiscoWhatsapp,
} from "@/lib/onboarding/risco-whatsapp";

describe("aceite da conexão não oficial", () => {
  it("mantém versão, ciência explícita e recomendação de número dedicado no mesmo contrato", () => {
    expect(RISCO_WHATSAPP_VERSAO).toBe("2026-10-01");
    expect(declaracaoDoRiscoWhatsapp).toMatch(/não oficial/i);
    expect(declaracaoDoRiscoWhatsapp).toMatch(/QR Code/i);
    expect(declaracaoDoRiscoWhatsapp).toMatch(/interrupções|desconex/i);
    expect(declaracaoDoRiscoWhatsapp).toMatch(/número empresarial dedicado/i);
  });

  it("recusa aceite implícito ou de uma versão diferente", () => {
    expect(
      aceiteDoRiscoWhatsappSchema.safeParse({
        accepted: false,
        version: RISCO_WHATSAPP_VERSAO,
      }).success,
    ).toBe(false);
    expect(
      aceiteDoRiscoWhatsappSchema.safeParse({ accepted: true, version: "antiga" }).success,
    ).toBe(false);
    expect(
      aceiteDoRiscoWhatsappSchema.safeParse({
        accepted: true,
        version: RISCO_WHATSAPP_VERSAO,
      }).success,
    ).toBe(true);
  });
});
