import { describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "@/lib/agent-engine/edge/llm/run-model-call";

import {
  CHECKPOINT_INSTRUCTION,
  CHECKPOINT_RETRY_INSTRUCTION,
  CheckpointSemJsonError,
  obterCheckpointDoFechamento,
  parseCheckpointText,
} from "@/lib/agent-engine/agent/inbound-turn";
import { LlmBudgetExceededError } from "@/lib/agent-engine/edge/llm/run-model-call";

/**
 * O fechamento do turno não pode devolver ao cliente a conta de um JSON mal
 * formatado.
 *
 * Medido em 11/11/2026 (harness local do Heitor v10, modelo real): com
 * `gpt-6-luna`, 7 de 48 turnos caíram em "fechamento do turno sem JSON de
 * checkpoint" — DEPOIS do `send_message`. O job voltava à fila com a resposta já
 * entregue e o retry re-rodava o turno inteiro. Com `gpt-5.4-mini`, 0 de 72.
 */

const CHECKPOINT = {
  commitments: ["mandar o orçamento"],
  objections: [],
  next_action: "conferir a resposta sobre o modelo do carro",
  rolling_summary: "cliente com polimento embaçado no capô",
};

const BASE: ModelMessage[] = [
  { role: "user", content: "abertura do turno" },
  { role: "user", content: CHECKPOINT_INSTRUCTION },
];

const ANTERIOR = {
  commitments: ["retornar amanhã"],
  objections: ["preço"],
  rolling_summary: "resumo do turno anterior",
};

const log = () => ({ warn: vi.fn(), error: vi.fn() });

/** Um `chamar` que devolve as respostas em ordem e guarda o que recebeu. */
function roteiro(...respostas: Array<string | Error>) {
  const recebidas: ModelMessage[][] = [];
  const chamar = async (messages: ModelMessage[]) => {
    recebidas.push(messages);
    const r = respostas[recebidas.length - 1];
    if (r === undefined) throw new Error("chamada a mais no fechamento");
    if (r instanceof Error) throw r;
    return r;
  };
  return { chamar, recebidas };
}

describe("parseCheckpointText — a extração tolerante", () => {
  it("JSON puro", () => {
    expect(parseCheckpointText(JSON.stringify(CHECKPOINT))).toMatchObject(CHECKPOINT);
  });

  it("dentro de cerca ```json, com prosa antes e depois", () => {
    const texto = `Claro! Segue o fechamento:\n\`\`\`json\n${JSON.stringify(CHECKPOINT, null, 2)}\n\`\`\`\nQualquer coisa, me avise.`;
    expect(parseCheckpointText(texto)).toMatchObject(CHECKPOINT);
  });

  it("prosa com chaves ANTES do JSON (o recorte primeiro-'{'-ao-último-'}' quebrava)", () => {
    const texto = `Resumo {do turno}: ${JSON.stringify(CHECKPOINT)}`;
    expect(parseCheckpointText(texto)).toMatchObject(CHECKPOINT);
  });

  it("dois objetos (rascunho e versão final): vale o último que valida", () => {
    const rascunho = JSON.stringify({ ...CHECKPOINT, rolling_summary: "rascunho" });
    const final = JSON.stringify(CHECKPOINT);
    expect(parseCheckpointText(`${rascunho}\n\nCorrigindo:\n${final}`)).toMatchObject(CHECKPOINT);
  });

  it("'}' e aspas escapadas dentro de string não fecham o objeto antes da hora", () => {
    const c = { ...CHECKPOINT, rolling_summary: 'disse "ok}" e saiu {' };
    expect(parseCheckpointText(`nota {x} ${JSON.stringify(c)}`).rolling_summary).toBe(
      'disse "ok}" e saiu {',
    );
  });

  it("sem JSON nenhum: CheckpointSemJsonError, sem o texto do modelo na mensagem", () => {
    const texto = "Turno encerrado. O cliente Fulano pediu orçamento.";
    let erro: unknown;
    try {
      parseCheckpointText(texto);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(CheckpointSemJsonError);
    expect((erro as Error).message).toMatch(/sem JSON de checkpoint/);
    expect((erro as Error).message).not.toContain("Fulano");
  });

  it("resposta vazia (só raciocínio, nada de texto) também é 'sem JSON'", () => {
    expect(() => parseCheckpointText("")).toThrow(CheckpointSemJsonError);
  });

  it("JSON truncado (saída cortada no limite de tokens) é erro de formato", () => {
    const truncado = JSON.stringify(CHECKPOINT).slice(0, 40);
    expect(() => parseCheckpointText(truncado)).toThrow(CheckpointSemJsonError);
  });

  it("shape inválido continua reprovando — não grava lixo", () => {
    expect(() =>
      parseCheckpointText('{"rolling_summary":"x","declaracao":{"intencoes":"nao é lista"}}'),
    ).toThrow(/shape inválido/);
  });
});

describe("obterCheckpointDoFechamento — 1 tentativa a mais, só do fechamento", () => {
  it("reprodução (gpt-6-luna): texto final VAZIO depois do envio NÃO derruba o turno", async () => {
    // O formato medido em 12/11/2026 na API da OpenAI: `status: completed`, um
    // item de raciocínio e uma `message` com `output_text` igual a "" — sem
    // truncamento, sem prosa. Nenhum parser tolerante salva texto vazio; o que
    // salva é pedir de novo. Antes, `parseCheckpointText` lançava e o job voltava
    // à fila com a mensagem entregue.
    const { chamar, recebidas } = roteiro(
      "",
      JSON.stringify(CHECKPOINT),
    );
    const r = await obterCheckpointDoFechamento({
      chamar,
      messages: BASE,
      jaFalouComOLead: true,
      anterior: ANTERIOR,
      isFatal: () => false,
      log: log(),
    });
    expect(r).toEqual({ kind: "modelo", content: expect.objectContaining(CHECKPOINT), tentativas: 2 });
    expect(recebidas).toHaveLength(2);
  });

  it("a 2ª tentativa vê a resposta ruim como turno do assistente e o pedido curto", async () => {
    const ruim = "Turno encerrado.";
    const { chamar, recebidas } = roteiro(ruim, JSON.stringify(CHECKPOINT));
    await obterCheckpointDoFechamento({
      chamar,
      messages: BASE,
      jaFalouComOLead: true,
      anterior: null,
      isFatal: () => false,
      log: log(),
    });
    expect(recebidas[1]).toEqual([
      ...BASE,
      { role: "assistant", content: ruim },
      { role: "user", content: CHECKPOINT_RETRY_INSTRUCTION },
    ]);
  });

  it("resposta vazia: a 2ª tentativa não manda turno de assistente vazio", async () => {
    const { chamar, recebidas } = roteiro("   ", JSON.stringify(CHECKPOINT));
    await obterCheckpointDoFechamento({
      chamar,
      messages: BASE,
      jaFalouComOLead: true,
      anterior: null,
      isFatal: () => false,
      log: log(),
    });
    expect(recebidas[1]).toEqual([...BASE, { role: "user", content: CHECKPOINT_RETRY_INSTRUCTION }]);
  });

  it("erro de transporte re-chama com a MESMA conversa", async () => {
    const { chamar, recebidas } = roteiro(new Error("503 do provedor"), JSON.stringify(CHECKPOINT));
    const r = await obterCheckpointDoFechamento({
      chamar,
      messages: BASE,
      jaFalouComOLead: true,
      anterior: null,
      isFatal: () => false,
      log: log(),
    });
    expect(r.kind).toBe("modelo");
    expect(recebidas[1]).toBe(BASE);
  });

  it("caminho feliz: UMA chamada só", async () => {
    const { chamar, recebidas } = roteiro(JSON.stringify(CHECKPOINT));
    const r = await obterCheckpointDoFechamento({
      chamar,
      messages: BASE,
      jaFalouComOLead: true,
      anterior: null,
      isFatal: () => false,
      log: log(),
    });
    expect(r).toMatchObject({ kind: "modelo", tentativas: 1 });
    expect(recebidas).toHaveLength(1);
  });

  it("duas falhas DEPOIS do envio: checkpoint degradado, sem erro (o turno não volta à fila)", async () => {
    const l = log();
    const { chamar, recebidas } = roteiro("sem json", "de novo sem json");
    const r = await obterCheckpointDoFechamento({
      chamar,
      messages: BASE,
      jaFalouComOLead: true,
      anterior: ANTERIOR,
      isFatal: () => false,
      log: l,
    });
    expect(recebidas).toHaveLength(2);
    expect(r.kind).toBe("degradado");
    // O anterior é levado adiante; next_action zera (issue #510) e a declaração
    // fica `undefined` — "o modelo não declarou", que vira NULL no banco.
    expect(r.content).toEqual({
      commitments: ANTERIOR.commitments,
      objections: ANTERIOR.objections,
      next_action: null,
      rolling_summary: ANTERIOR.rolling_summary,
    });
    expect(r.content.declaracao).toBeUndefined();
    expect(l.error).toHaveBeenCalledTimes(1);
  });

  it("degradado no primeiro turno do lead (sem anterior): checkpoint vazio, mas gravável", async () => {
    const { chamar } = roteiro("x", "y");
    const r = await obterCheckpointDoFechamento({
      chamar,
      messages: BASE,
      jaFalouComOLead: true,
      anterior: null,
      isFatal: () => false,
      log: log(),
    });
    expect(r.content).toEqual({ commitments: [], objections: [], next_action: null, rolling_summary: "" });
  });

  it("duas falhas SEM envio: o erro sobe e a fila re-tenta (nada a duplicar)", async () => {
    const { chamar } = roteiro("sem json", "sem json");
    await expect(
      obterCheckpointDoFechamento({
        chamar,
        messages: BASE,
        jaFalouComOLead: false,
        anterior: ANTERIOR,
        isFatal: () => false,
        log: log(),
      }),
    ).rejects.toThrow(/sem JSON de checkpoint — run re-tentado pela fila/);
  });

  it("orçamento estourado sobe na hora, sem 2ª chamada (é o handoff por orçamento que trata)", async () => {
    const estouro = new LlmBudgetExceededError();
    const { chamar, recebidas } = roteiro(estouro, JSON.stringify(CHECKPOINT));
    await expect(
      obterCheckpointDoFechamento({
        chamar,
        messages: BASE,
        jaFalouComOLead: true,
        anterior: ANTERIOR,
        isFatal: (e) => e instanceof LlmBudgetExceededError,
        log: log(),
      }),
    ).rejects.toBe(estouro);
    expect(recebidas).toHaveLength(1);
  });

  it("o log não carrega o texto do modelo (PII)", async () => {
    const l = log();
    const { chamar } = roteiro("O cliente Fulano da Silva disse tchau", JSON.stringify(CHECKPOINT));
    await obterCheckpointDoFechamento({
      chamar,
      messages: BASE,
      jaFalouComOLead: true,
      anterior: null,
      isFatal: () => false,
      log: l,
    });
    expect(JSON.stringify(l.warn.mock.calls)).not.toContain("Fulano");
  });
});

describe("runModelCall({ respostaEmJson }) — o modo JSON chega ao provedor", () => {
  const ORG = "33333333-3333-4333-8333-333333333333";
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("settings->'llm'")) {
        return {
          rows: [
            {
              llm: {
                provider: "anthropic",
                default_model: "modelo-fake",
                params: {},
                enabled_models: [],
                monthly_budget_cents: null,
              },
            },
          ],
        };
      }
      if (sql.includes("insert into llm_calls")) return { rows: [{ id: "call-1" }] };
      return { rows: [] };
    }),
  } as never;

  async function chamar(respostaEmJson: boolean | undefined, texto: string) {
    const { createFakeRegistry } = await import("@/lib/agent-engine/edge/llm/providers");
    const { runModelCall } = await import("@/lib/agent-engine/edge/llm/run-model-call");
    const formatos: unknown[] = [];
    const registry = createFakeRegistry((async (opts: { responseFormat?: unknown }) => {
      formatos.push(opts.responseFormat);
      return {
        content: [{ type: "text" as const, text: texto }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      };
    }) as never);
    const r = await runModelCall(
      pool,
      { anthropicApiKey: "sk-teste", cacheTtl: "1h" } as never,
      {
        tenantId: ORG,
        purpose: "checkpoint",
        messages: [{ role: "user", content: CHECKPOINT_INSTRUCTION }],
        ...(respostaEmJson === undefined ? {} : { respostaEmJson }),
      },
      { registry },
    );
    return { formatos, texto: r.result.text };
  }

  it("ligado: o provedor recebe responseFormat json (vira json_object na OpenAI/OpenRouter)", async () => {
    const { formatos } = await chamar(true, JSON.stringify(CHECKPOINT));
    expect(formatos).toEqual([{ type: "json" }]);
  });

  it("desligado (todo outro ponto): nada muda no pedido", async () => {
    const { formatos } = await chamar(undefined, "ok");
    expect(formatos[0] === undefined || (formatos[0] as { type: string }).type === "text").toBe(true);
  });

  it("provedor que ignora o modo e cerca o JSON: o texto volta CRU, sem lançar — o parser do fechamento aceita", async () => {
    const cercado = "```json\n" + JSON.stringify(CHECKPOINT) + "\n```";
    const { texto } = await chamar(true, cercado);
    expect(texto).toBe(cercado);
    expect(parseCheckpointText(texto)).toMatchObject(CHECKPOINT);
  });

  it("resposta vazia também volta crua (quem decide é obterCheckpointDoFechamento)", async () => {
    const { texto } = await chamar(true, "");
    expect(texto).toBe("");
  });
});
