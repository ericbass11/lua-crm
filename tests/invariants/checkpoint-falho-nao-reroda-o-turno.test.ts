import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import type * as InboundTurn from "@/lib/agent-engine/agent/inbound-turn";
import type * as Providers from "@/lib/agent-engine/edge/llm/providers";
import type * as Queue from "@/lib/agent-engine/queue/queue";
import type * as ObsLogger from "@/lib/agent-engine/obs/logger";

/**
 * O fechamento do turno sem JSON NÃO devolve à fila um turno que já respondeu.
 *
 * Medido em 11–12/11/2026 com `gpt-6-luna` (harness local do Heitor v10, modelo
 * real): ~15% dos fechamentos voltaram com o texto final VAZIO. O fechamento
 * roda DEPOIS do `send_message`, e `parseCheckpointText` lançava — o job voltava
 * à fila com a resposta entregue, e o retry re-rodava o turno INTEIRO (modelo,
 * ferramentas e qualquer envio que o ledger ainda não conhecia).
 *
 * Pelo handler real de `inbound_turn`, contra o banco:
 *   1. vazio nas duas tentativas, depois do envio → o job TERMINA, com UM envio,
 *      o turno do agente rodado UMA vez e um checkpoint DEGRADADO gravado para o
 *      job (o anterior levado adiante, sem next_action, declaração NULL);
 *   2. vazio e depois JSON → o checkpoint do modelo é gravado, sem degradar;
 *   3. sem envio nenhum, fechamento vazio nas duas → o erro sobe e a fila
 *      re-tenta, como antes (não há o que duplicar).
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "placeholder-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "placeholder-service";

const PORT = Number(process.env.TEST_DB_PORT ?? 54329);
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`,
  max: 2,
});

const ORG = "eee10000-0000-4000-8000-000000000001";
const CONTACT = "eee10000-0000-4000-8000-000000000002";
const SESSION = "eee10000-0000-4000-8000-000000000003";
const CONV = "eee10000-0000-4000-8000-000000000004";

type Modules = {
  createInboundTurnHandler: typeof InboundTurn.createInboundTurnHandler;
  queue: typeof Queue;
  createLogger: typeof ObsLogger.createLogger;
  createFakeRegistry: typeof Providers.createFakeRegistry;
};
let m: Modules;

const USO = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

const CHECKPOINT_DO_MODELO = JSON.stringify({
  commitments: ["mandar o orçamento"],
  objections: [],
  next_action: "conferir a resposta do cliente",
  rolling_summary: "resumo escrito pelo modelo neste turno",
});

let chamadasDoTurno = 0;
let chamadasDoFechamento = 0;
let enviados = 0;

/**
 * Modelo fake: no turno, chama `send_message` (ou só encerra, se `fala` for
 * falso); no fechamento, devolve as respostas de `fechamentos` em ordem.
 */
function modelo(opts: { fala: boolean; fechamentos: string[] }) {
  return async (call: { prompt?: unknown }) => {
    const prompt = JSON.stringify(call.prompt ?? []);
    if (prompt.includes("Feche o turno AGORA")) {
      const texto = opts.fechamentos[chamadasDoFechamento] ?? "";
      chamadasDoFechamento += 1;
      return {
        content: [{ type: "text" as const, text: texto }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    chamadasDoTurno += 1;
    if (opts.fala && !prompt.includes('"tool-result"')) {
      return {
        content: [
          {
            type: "tool-call" as const,
            toolCallId: "c1",
            toolName: "send_message",
            input: JSON.stringify({ body: "Oi! Já te mando o orçamento." }),
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: USO,
        warnings: [],
      };
    }
    return {
      content: [{ type: "text" as const, text: "" }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: USO,
      warnings: [],
    };
  };
}

function montaHandler(doGenerate: unknown) {
  return m.createInboundTurnHandler({
    crmCfg: { supabase: {} as never },
    llmCfg: { anthropicApiKey: "fake" } as never,
    knobs: {
      historyLimit: 10,
      maxContextTokens: 1000,
      notesIndexMaxTokens: 500,
      maxSteps: 4,
      queuedRetryDelayMs: 1000,
      breaker: {
        exactFailureWarn: 2,
        exactFailureBlock: 5,
        sameToolFailureWarn: 3,
        sameToolFailureHalt: 8,
        noProgressWarn: 3,
        noProgressBlock: 5,
      },
    },
    log: m.createLogger(),
    registry: m.createFakeRegistry(doGenerate as never),
    channel: () =>
      ({
        channel: "captura",
        send: async () => {
          enviados += 1;
          return { kind: "sent" as const, idempotencyKey: `k${enviados}`, messageId: `m${enviados}` };
        },
        sessionHealth: async () => ({ healthy: true, status: "WORKING" }),
        capabilities: () => ({ freeform: true, media: true, audio: true }),
        costPerMessage: () => ({ currency: "BRL", cents: 0 }),
      }) as never,
    // Dentro da janela anti-ban (7h-22h BRT), como os vizinhos.
    clock: () => new Date("2026-07-28T18:00:00Z"),
    sleep: async () => {},
  });
}

/** O contrato do worker (`runJob`): sucesso → completeJob, falha → failJob. */
async function rodaTurno(doGenerate: unknown): Promise<{ jobId: string; erro: Error | null }> {
  await pool.query("update job_queue set status = 'done' where status = 'pending'");
  const msgId = crypto.randomUUID();
  await pool.query(
    `insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
       type, direction, status, body, sent_via, sent_at, created_at)
     values ($1,$2,$3,$4,$5,'text','inbound','delivered','quanto fica o polimento?','external_device',now(),now())`,
    [msgId, ORG, CONV, SESSION, CONTACT],
  );
  const { job } = await m.queue.enqueueJob(pool, ORG, {
    kind: "inbound_turn",
    leadId: CONTACT,
    payload: {
      conversation_id: CONV,
      contact_id: CONTACT,
      channel_session_id: SESSION,
      inbound_message_id: msgId,
      crm_event_id: crypto.randomUUID(),
    },
    // DUAS tentativas: com uma só, um `failJob` mataria o job e "não voltou à
    // fila" passaria por vacuidade.
    maxAttempts: 2,
  });
  const [claimed] = await m.queue.claimJobs(pool, { workerId: "ck", maxConcurrency: 1 });
  expect(claimed?.id).toBe(job.id);
  try {
    await montaHandler(doGenerate)(claimed!, pool, { workerId: "ck" });
    await m.queue.completeJob(pool, claimed!.id, "ck");
    return { jobId: job.id, erro: null };
  } catch (err) {
    await m.queue.failJob(pool, claimed!.id, "ck", err);
    return { jobId: job.id, erro: err as Error };
  }
}

async function checkpointDoJob(jobId: string) {
  const { rows } = await pool.query<{
    commitments: string[];
    objections: string[];
    next_action: string | null;
    rolling_summary: string;
    declaracao: unknown;
  }>(
    `select commitments, objections, next_action, rolling_summary, declaracao
       from lead_checkpoints where organization_id = $1 and job_id = $2`,
    [ORG, jobId],
  );
  return rows;
}

async function statusDoJob(jobId: string): Promise<string> {
  const { rows } = await pool.query<{ status: string }>(
    "select status from job_queue where id = $1",
    [jobId],
  );
  return rows[0]!.status;
}

beforeAll(async () => {
  m = {
    createInboundTurnHandler: (await import("@/lib/agent-engine/agent/inbound-turn"))
      .createInboundTurnHandler,
    queue: await import("@/lib/agent-engine/queue/queue"),
    createLogger: (await import("@/lib/agent-engine/obs/logger")).createLogger,
    createFakeRegistry: (await import("@/lib/agent-engine/edge/llm/providers")).createFakeRegistry,
  };
  await pool.query(
    `insert into organizations (id, slug, legal_name, display_name)
     values ($1,'checkpoint-falho','Checkpoint Falho','Checkpoint Falho') on conflict (id) do nothing`,
    [ORG],
  );
  await pool.query(
    `insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
     values ($1,$2,'checkpoint-falho-session','WORKING','\\x00'::bytea) on conflict (id) do nothing`,
    [SESSION, ORG],
  );
  await pool.query(
    `with v as (
       insert into playbook_versions (organization_id, layer, content)
       select null, 'platform', E'## Identidade\nAssistente de teste.'
       where not exists (select 1 from playbook_pointers where organization_id is null and layer = 'platform')
       returning id)
     insert into playbook_pointers (organization_id, layer, version_id)
     select null, 'platform', id from v`,
  );
});

beforeEach(async () => {
  chamadasDoTurno = 0;
  chamadasDoFechamento = 0;
  enviados = 0;
  await pool.query("delete from lead_checkpoints where organization_id = $1", [ORG]);
  await pool.query("delete from send_ledger where organization_id = $1", [ORG]);
  await pool.query("delete from messages where organization_id = $1", [ORG]);
  await pool.query("delete from job_queue where organization_id = $1", [ORG]);
  await pool.query("delete from conversations where organization_id = $1", [ORG]);
  await pool.query("delete from contacts where organization_id = $1", [ORG]);
  await pool.query(
    `insert into contacts (id, organization_id, name, phone_number)
     values ($1,$2,'Lead do fechamento','+5511900000999')`,
    [CONTACT, ORG],
  );
  await pool.query(
    `insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
     values ($1,$2,$3,$4,'ai_handling',false)`,
    [CONV, ORG, CONTACT, SESSION],
  );
  // O checkpoint do turno ANTERIOR — é o que o degradado leva adiante.
  await pool.query(
    `insert into lead_checkpoints (organization_id, contact_id, commitments, objections, next_action, rolling_summary)
     values ($1,$2,'["retornar amanhã"]'::jsonb,'["preço"]'::jsonb,'perguntar o modelo do carro','resumo do turno anterior')`,
    [ORG, CONTACT],
  );
});

describe("fechamento sem JSON depois do envio", () => {
  it("vazio nas duas tentativas: o job termina, um envio só, checkpoint degradado gravado", async () => {
    const { jobId, erro } = await rodaTurno(modelo({ fala: true, fechamentos: ["", ""] }));

    expect(erro).toBeNull();
    expect(await statusDoJob(jobId)).toBe("done");
    expect(enviados).toBe(1);
    // O turno do agente rodou UMA vez (a chamada do send_message e a que
    // encerra); só o fechamento foi repetido.
    expect(chamadasDoTurno).toBe(2);
    expect(chamadasDoFechamento).toBe(2);

    const linhas = await checkpointDoJob(jobId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toEqual({
      commitments: ["retornar amanhã"],
      objections: ["preço"],
      next_action: null,
      rolling_summary: "resumo do turno anterior",
      declaracao: null,
    });
  });

  it("vazio e depois JSON: vale o checkpoint do modelo", async () => {
    const { jobId, erro } = await rodaTurno(
      modelo({ fala: true, fechamentos: ["", CHECKPOINT_DO_MODELO] }),
    );

    expect(erro).toBeNull();
    expect(enviados).toBe(1);
    expect(chamadasDoFechamento).toBe(2);
    const linhas = await checkpointDoJob(jobId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.rolling_summary).toBe("resumo escrito pelo modelo neste turno");
    expect(linhas[0]?.next_action).toBe("conferir a resposta do cliente");
  });

  it("controle — sem envio, fechamento vazio nas duas: o erro sobe e a fila re-tenta", async () => {
    const { jobId, erro } = await rodaTurno(modelo({ fala: false, fechamentos: ["", ""] }));

    expect(erro?.message).toMatch(/sem JSON de checkpoint — run re-tentado pela fila/);
    expect(enviados).toBe(0);
    expect(chamadasDoFechamento).toBe(2);
    expect(await checkpointDoJob(jobId)).toHaveLength(0);
    // Volta à fila (attempts < max_attempts), e não morre.
    expect(await statusDoJob(jobId)).toBe("pending");
  });
});
