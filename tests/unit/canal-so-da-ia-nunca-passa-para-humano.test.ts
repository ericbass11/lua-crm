/**
 * CANAL SÓ DA IA — A CONVERSA NUNCA VAI PARA UMA FILA QUE NINGUÉM ATENDE.
 *
 * Medido em produção em 30/10/2026: os dois números de teste de um canal que é
 * só da IA foram passados a humano por `low_confidence` (teto de etapas). O
 * efeito foi `force_human = true` + `bot_silenced_until = 'infinity'` — a IA
 * ficou muda para eles por dias, com a passagem numa fila sem atendente. A
 * versão publicada tinha `handoff_tool_enabled = false`, que só tira a
 * ferramenta do modelo: os outros caminhos não a leem.
 *
 * O que se prova aqui:
 *   1. a leitura da chave (`metadata.ai_sem_humano`) só liga com `true`;
 *   2. `performHumanHandoff` — o ponto único do motor — recusa, sem escrever;
 *   3. a escolta do orçamento não avisa "uma pessoa vai assumir" nem passa;
 *   4. os desvios do turno (`inbound-turn.ts`) leem a chave — pelo texto, com
 *      controle negativo, porque `runAgentTurn` não é alcançável por unidade.
 * Em todos, o canal SEM a chave segue passando como antes (controle).
 * O caminho legado (`triggerHandoff`) tem arquivo próprio, porque precisa
 * dublar o `supabase-js` inteiro.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { performHumanHandoff, applyRequestHumanHandoff } from "@/lib/agent-engine/agent/human-handoff";
import { comHandoffSeOrcamentoAcabar } from "@/lib/agent-engine/agent/inbound-turn";
import { LlmBudgetExceededError } from "@/lib/agent-engine/edge/llm/run-model-call";
import { montarBriefingDaPassagem } from "@/lib/escalacao/briefing-da-passagem";
import { canalSemHumano, CHAVE_CANAL_SEM_HUMANO } from "@/lib/escalacao/canal-sem-humano";

const ORG = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const CONVERSA = "33333333-3333-4333-8333-333333333333";
const IDS = { tenantId: ORG, leadId: LEAD, conversationId: CONVERSA };

/** Pool falso: a leitura do canal devolve o `metadata` dado; o resto, vazio. */
function poolDoCanal(metadata: Record<string, unknown> | null) {
  const chamadas: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    chamadas.push({ sql, params });
    if (sql.includes("channel_metadata")) return { rows: [{ channel_metadata: metadata }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query } as never, chamadas };
}

const escritas = (chamadas: Array<{ sql: string }>) =>
  chamadas.filter((c) => /\b(update|insert|delete)\b/iu.test(c.sql));

function logFalso() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
}

const opcoesDaPassagem = () => ({
  reason: "low_confidence",
  conversationSummary: "resumo",
  passagem: {
    origem: "runtime_nativo" as const,
    motivoCodigo: "low_confidence" as const,
    briefing: montarBriefingDaPassagem({ checkpoint: null, motivo: { codigo: "low_confidence" } }),
  },
  log: logFalso(),
});

describe("a chave do canal", () => {
  it("só `true` liga — ausente, string, número ou null é o comportamento de sempre", () => {
    expect(canalSemHumano({ [CHAVE_CANAL_SEM_HUMANO]: true })).toBe(true);
    for (const valor of [undefined, false, "true", 1, null]) {
      expect(canalSemHumano({ [CHAVE_CANAL_SEM_HUMANO]: valor })).toBe(false);
    }
    expect(canalSemHumano(null)).toBe(false);
    expect(canalSemHumano([])).toBe(false);
  });
});

describe("performHumanHandoff num canal só da IA", () => {
  it("recusa a passagem e não escreve nada — nem force_human, nem silêncio, nem fila", async () => {
    const { pool, chamadas } = poolDoCanal({ ai_gate: "allowlist", ai_sem_humano: true });

    const desfecho = await performHumanHandoff(pool, IDS, opcoesDaPassagem());

    expect(desfecho).toBe("canal_sem_humano");
    expect(escritas(chamadas), "a passagem escreveu num canal só da IA").toEqual([]);
  });

  it("controle: canal sem a chave passa como sempre", async () => {
    const { pool, chamadas } = poolDoCanal({ ai_gate: "allowlist" });

    const desfecho = await performHumanHandoff(pool, IDS, opcoesDaPassagem());

    expect(desfecho).toBe("feita");
    expect(chamadas.some((c) => c.sql.includes("set force_human = true"))).toBe(true);
    expect(chamadas.some((c) => c.sql.includes("insert into passagens_de_atendimento"))).toBe(true);
  });

  it("erro ao ler o canal → passa como sempre (o comportamento de todo outro canal)", async () => {
    const chamadas: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        chamadas.push(sql);
        if (sql.includes("channel_metadata")) throw new Error("banco fora");
        return { rows: [], rowCount: 0 };
      }),
    } as never;

    expect(await performHumanHandoff(pool, IDS, opcoesDaPassagem())).toBe("feita");
    expect(chamadas.some((sql) => sql.includes("set force_human = true"))).toBe(true);
  });

  it("a ferramenta do modelo devolve erro de ensino em vez de prometer uma pessoa", async () => {
    const { pool, chamadas } = poolDoCanal({ ai_sem_humano: true });

    const r = await applyRequestHumanHandoff(
      pool,
      IDS,
      { conversationSummary: "resumo", log: logFalso() },
      { por_que: "cliente quer falar com alguém" },
    );

    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe("canal_sem_humano");
    expect(escritas(chamadas)).toEqual([]);
  });
});

describe("a escolta do orçamento num canal só da IA", () => {
  const contexto = (pool: unknown, avisarLead: () => Promise<{ avisado: boolean }>) => ({
    pool: pool as never,
    tenantId: ORG,
    leadId: LEAD,
    conversationId: CONVERSA,
    briefingDoCheckpoint: async () => montarBriefingDaPassagem({ checkpoint: null }),
    avisarLead: avisarLead as never,
    log: logFalso(),
  });

  it("o erro sobe como antes, mas sem aviso de atendente e sem passagem", async () => {
    const { pool, chamadas } = poolDoCanal({ ai_sem_humano: true });
    const avisar = vi.fn(async () => ({ avisado: true }));
    const erro = new LlmBudgetExceededError();

    await expect(
      comHandoffSeOrcamentoAcabar(contexto(pool, avisar), async () => {
        throw erro;
      }),
    ).rejects.toBe(erro);

    expect(avisar, "avisou 'uma pessoa vai assumir' num número sem pessoas").not.toHaveBeenCalled();
    expect(escritas(chamadas)).toEqual([]);
  });

  it("controle: canal sem a chave avisa e passa", async () => {
    const { pool, chamadas } = poolDoCanal({});
    const avisar = vi.fn(async () => ({ avisado: true }));

    await expect(
      comHandoffSeOrcamentoAcabar(contexto(pool, avisar), async () => {
        throw new LlmBudgetExceededError();
      }),
    ).rejects.toThrow();

    expect(avisar).toHaveBeenCalledOnce();
    expect(chamadas.some((c) => c.sql.includes("set force_human = true"))).toBe(true);
  });
});

describe("os desvios do turno leem a chave", () => {
  const fonte = readFileSync(join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");

  /** O trecho de código que vai de `inicio` até o primeiro `fim` depois dele. */
  function trecho(texto: string, inicio: string, fim: string): string {
    const i = texto.indexOf(inicio);
    if (i < 0) return "";
    return texto.slice(i, texto.indexOf(fim, i) + fim.length);
  }

  const condicoes = (texto: string) => ({
    pedidoExplicito: trecho(texto, "if (\n    !preview &&", "matchesHandoffKeyword"),
    optOutLinha: texto.split("\n").find((l) => l.includes("detectAmbiguousOptOut(texto))")) ?? "",
    tetoDeEtapas: texto.split("\n").find((l) => l.includes("...(!preview && !optedOutThisTurn")) ?? "",
    ferramenta: texto.split("\n").find((l) => l.includes("!agentConfig.handoffToolEnabled")) ?? "",
  });

  it("pedido explícito, opt-out ambíguo, teto de etapas e ferramenta desviam no canal só da IA", () => {
    const c = condicoes(fonte);
    expect(c.pedidoExplicito, "pedido explícito de atendente").toContain("!semHumano");
    expect(c.optOutLinha, "opt-out ambíguo").toContain("!semHumano");
    expect(c.tetoDeEtapas, "teto de etapas (o caso medido)").toContain("!semHumano");
    expect(c.ferramenta, "ferramenta request_human_handoff").toContain("semHumano");
  });

  it("controle negativo: o detector reprova a fonte sem a chave", () => {
    const c = condicoes(fonte.replaceAll("!semHumano &&", "").replaceAll("&& !semHumano", "").replaceAll(" || semHumano", ""));
    expect(c.pedidoExplicito).not.toContain("!semHumano");
    expect(c.optOutLinha).not.toContain("!semHumano");
    expect(c.tetoDeEtapas).not.toContain("!semHumano");
    expect(c.ferramenta).not.toContain("semHumano");
  });
});
