/**
 * Régua do formulário de Proteção de envio (anti-ban).
 *
 * Bug que originou estes testes: salvar a Proteção devolvia `422` com a mensagem
 * genérica "Campos inválidos.". O campo "variação de até" é em SEGUNDOS e o
 * schema aceita no máximo `KNOB_BOUNDS.intervalMaxMs` (600.000 ms), então 2497
 * digitado virava 2.497.000 ms e o Zod recusava — sem a tela dizer qual campo
 * nem qual limite. Junto vinham duas falhas silenciosas: vírgula decimal e texto
 * não-numérico caíam em `NaN`, que o JSON transforma em `null`, e `null`
 * significa "voltar ao padrão do motor" — o operador achava que tinha salvo.
 */
import { describe, expect, it } from "vitest";

import { KNOB_BOUNDS } from "@/lib/agent-engine/pacing/defaults";
import {
  descreveErroDeValidacao,
  lerInteiro,
  lerSegundosEmMs,
  parseDecimalPtBr,
} from "@/lib/ai/pacing-form";

const TETO = KNOB_BOUNDS.intervalMaxMs;

describe("lerSegundosEmMs — campo em segundos contra o teto do motor (em ms)", () => {
  it("o valor que causou o 422 é recusado ANTES da API, dizendo o limite em segundos", () => {
    const r = lerSegundosEmMs("2497", "Variação do ritmo", TETO);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("Variação do ritmo");
      // O limite tem que aparecer na unidade do CAMPO (600s), nunca em ms.
      expect(r.erro).toContain(`${TETO / 1000}s`);
      expect(r.erro).not.toContain(String(TETO));
    }
  });

  it("converte segundos em milissegundos", () => {
    expect(lerSegundosEmMs("1.2", "Ritmo", TETO)).toEqual({ ok: true, valor: 1200 });
  });

  it("aceita vírgula decimal (pt-BR) em vez de virar NaN → null silencioso", () => {
    expect(lerSegundosEmMs("1,2", "Ritmo", TETO)).toEqual({ ok: true, valor: 1200 });
  });

  it("campo vazio é null — contrato 'usar o padrão do motor'", () => {
    expect(lerSegundosEmMs("", "Ritmo", TETO)).toEqual({ ok: true, valor: null });
    expect(lerSegundosEmMs("   ", "Ritmo", TETO)).toEqual({ ok: true, valor: null });
  });

  it("texto não-numérico é ERRO, não default silencioso", () => {
    const r = lerSegundosEmMs("abc", "Ritmo", TETO);
    expect(r.ok).toBe(false);
  });

  it("recusa negativo", () => {
    expect(lerSegundosEmMs("-1", "Ritmo", TETO).ok).toBe(false);
  });

  it("aceita exatamente o teto (fronteira fechada, igual ao schema)", () => {
    expect(lerSegundosEmMs(String(TETO / 1000), "Ritmo", TETO)).toEqual({ ok: true, valor: TETO });
  });
});

describe("lerInteiro — horas da janela e teto diário", () => {
  it("aceita dentro da faixa e arredonda", () => {
    expect(lerInteiro("8", "Início", 0, KNOB_BOUNDS.hourLastStart)).toEqual({ ok: true, valor: 8 });
    expect(lerInteiro("7.6", "Início", 0, KNOB_BOUNDS.hourLastStart)).toEqual({ ok: true, valor: 8 });
  });

  it("recusa fora da faixa dizendo a faixa", () => {
    const r = lerInteiro("25", "Fim da janela", 1, KNOB_BOUNDS.hourEnd);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain(`entre 1 e ${KNOB_BOUNDS.hourEnd}`);
  });

  it("vazio é null (usar padrão) e texto é erro", () => {
    expect(lerInteiro("", "Início", 0, 23)).toEqual({ ok: true, valor: null });
    expect(lerInteiro("oito", "Início", 0, 23).ok).toBe(false);
  });
});

describe("parseDecimalPtBr", () => {
  it("distingue vazio (null) de inválido (undefined)", () => {
    expect(parseDecimalPtBr("")).toBeNull();
    expect(parseDecimalPtBr("x")).toBeUndefined();
    expect(parseDecimalPtBr("3,5")).toBe(3.5);
  });

  it("Infinity não passa por número válido", () => {
    expect(parseDecimalPtBr("Infinity")).toBeUndefined();
  });
});

describe("descreveErroDeValidacao — o details do 422 vira linha legível", () => {
  it("extrai campo e mensagem do flatten do Zod", () => {
    const details = {
      formErrors: [],
      fieldErrors: { jitter_max_ms: ["Too big: expected number to be <=600000"] },
    };
    expect(descreveErroDeValidacao(details)).toBe(
      "jitter_max_ms: Too big: expected number to be <=600000",
    );
  });

  it("sem details ou sem fieldErrors devolve null (o chamador mostra só a mensagem)", () => {
    expect(descreveErroDeValidacao(undefined)).toBeNull();
    expect(descreveErroDeValidacao({ formErrors: [] })).toBeNull();
    expect(descreveErroDeValidacao({ fieldErrors: {} })).toBeNull();
  });
});
