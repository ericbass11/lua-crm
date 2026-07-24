/**
 * Tests for lib/ai/runtime/guardrails.ts — motor de guardrails de saída.
 *
 * Foco no gate de preço (princípio nº1: nunca inventar valor) + os dois
 * guardrails configuráveis ativados (regex_output_block, rag_must_hit).
 */
import { describe, expect, it } from "vitest";

import type { Guardrails } from "@/lib/ai/guardrails-schema";
import {
  evaluateOutputGuardrails,
  extractMonetaryValues,
  normalizeNumeric,
  ungroundedPrices,
} from "./guardrails";

describe("normalizeNumeric", () => {
  it("canoniza formatos pt-BR para a mesma chave", () => {
    expect(normalizeNumeric("1.234,56")).toBe("1234.56");
    expect(normalizeNumeric("1.200")).toBe("1200");
    expect(normalizeNumeric("99,90")).toBe("99.9");
    expect(normalizeNumeric("50")).toBe("50");
    expect(normalizeNumeric("1234")).toBe("1234");
  });
});

describe("extractMonetaryValues", () => {
  it("captura R$ e 'reais', normalizados e sem duplicar", () => {
    expect(extractMonetaryValues("Sai por R$ 1.234,56 à vista")).toEqual(["1234.56"]);
    expect(extractMonetaryValues("custa 50 reais")).toEqual(["50"]);
    expect(extractMonetaryValues("R$ 99,90 ou 99,90 reais")).toEqual(["99.9"]);
  });

  it("IGNORA números que não são preço (hora, duração, quantidade)", () => {
    expect(extractMonetaryValues("te ligo às 15h, em 10 minutos")).toEqual([]);
    expect(extractMonetaryValues("tenho 2 opções e 3 horários")).toEqual([]);
  });
});

describe("ungroundedPrices", () => {
  it("não bloqueia preço presente na fonte (formatos diferentes casam)", () => {
    expect(
      ungroundedPrices({
        text: "Fica em R$ 1200",
        groundingCorpus: "Produto A custa 1.200,00 reais no catálogo",
      }),
    ).toEqual([]);
  });

  it("bloqueia preço ausente da fonte", () => {
    expect(
      ungroundedPrices({
        text: "Consigo fazer por R$ 999,00",
        groundingCorpus: "Base de conhecimento sem esse valor",
      }),
    ).toEqual(["999"]);
  });

  it("não trata preço dito pelo CLIENTE como fonte (corpus não inclui inbound)", () => {
    // O corpus verificado é só prompt+RAG+tools; a mensagem do cliente não entra.
    expect(
      ungroundedPrices({
        text: "Sim, R$ 4500 está correto",
        groundingCorpus: "Você é um vendedor. Nunca invente valores.",
      }),
    ).toEqual(["4500"]);
  });

  it("sem preço citado → nada a bloquear", () => {
    expect(
      ungroundedPrices({ text: "Claro, posso te ajudar!", groundingCorpus: "" }),
    ).toEqual([]);
  });
});

describe("evaluateOutputGuardrails", () => {
  const noGuardrails: Guardrails = [];

  it("bloqueia (price_unground) preço sem fonte", () => {
    const v = evaluateOutputGuardrails({
      text: "O plano premium sai por R$ 349,90",
      groundingCorpus: "Você é um assistente. Base: plano básico.",
      guardrails: noGuardrails,
      citationCount: 1,
    });
    expect(v.blocked).toBe(true);
    expect(v.kind).toBe("price_unground");
    expect(v.detail?.blocked_values).toContain("349.9");
  });

  it("libera preço fundamentado no corpus", () => {
    const v = evaluateOutputGuardrails({
      text: "O plano premium sai por R$ 349,90",
      groundingCorpus: "Tabela: plano premium R$ 349,90 por mês.",
      guardrails: noGuardrails,
      citationCount: 1,
    });
    expect(v.blocked).toBe(false);
  });

  it("libera preço vindo de resultado de tool (no corpus)", () => {
    const v = evaluateOutputGuardrails({
      text: "O total do seu pedido é R$ 1.580,00",
      groundingCorpus: 'tool_result: {"order_total_cents": 158000, "formatted": "R$ 1.580,00"}',
      guardrails: noGuardrails,
      citationCount: 0,
    });
    expect(v.blocked).toBe(false);
  });

  it("aplica regex_output_block configurado", () => {
    const guardrails = [
      { kind: "regex_output_block", pattern: "cupom", flags: "i", reason: "Não prometer cupom" },
    ] as unknown as Guardrails;
    const v = evaluateOutputGuardrails({
      text: "Te mando um cupom de desconto",
      groundingCorpus: "",
      guardrails,
      citationCount: 1,
    });
    expect(v.blocked).toBe(true);
    expect(v.kind).toBe("regex_output_block");
  });

  it("aplica rag_must_hit quando não houve citação suficiente", () => {
    const guardrails = [
      { kind: "rag_must_hit", min_citations: 1, reason: "Responder só com base" },
    ] as unknown as Guardrails;
    const blocked = evaluateOutputGuardrails({
      text: "Resposta genérica sem base",
      groundingCorpus: "",
      guardrails,
      citationCount: 0,
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.kind).toBe("rag_must_hit");

    const ok = evaluateOutputGuardrails({
      text: "Resposta genérica sem base",
      groundingCorpus: "",
      guardrails,
      citationCount: 1,
    });
    expect(ok.blocked).toBe(false);
  });

  it("gate de preço pode ser desligado em teste (priceGateEnabled=false)", () => {
    const v = evaluateOutputGuardrails({
      text: "R$ 999,00",
      groundingCorpus: "",
      guardrails: noGuardrails,
      citationCount: 1,
      priceGateEnabled: false,
    });
    expect(v.blocked).toBe(false);
  });
});
