import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { createInboundTurnHandler, CHECKPOINT_INSTRUCTION } from '@/lib/agent-engine/agent/inbound-turn';
import { createFakeRegistry } from '@/lib/agent-engine/edge/llm/providers';
import { enqueueJob, claimJobs, completeJob, failJob, type JobRow } from '@/lib/agent-engine/queue/queue';
import { withServiceJob } from '@/lib/atendimento/fronteira-server';
import { STEP_LIMIT_REPLY } from '@/lib/agent-engine/agent/step-limit-recovery';
import type { ChannelSendInput, ChannelSendResult } from '@/lib/agent-engine/channel-adapter';

if (!process.env.TEST_DB_CONTAINER) throw new Error('Use pnpm test:db para o banco efêmero.');
const pool = new pg.Pool({
  connectionString: `postgres://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? '54329'}/postgres`,
  max: 4,
});
const ORG = 'cb281000-0000-4000-8000-000000000001';
const FOREIGN_ORG = 'cb281000-0000-4000-8000-000000000002';
const USER = 'cb281000-0000-4000-8000-000000000003';
const CLOCK = new Date('2026-10-28T18:00:00Z');
const MAX_STEPS = 10;
const requestedOrigins = new Set<string>();
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const checkpoint = JSON.stringify({ commitments: [], objections: [], next_action: null, rolling_summary: 'Cenário local de recuperação.' });

interface Scenario { org: string; contact: string; session: string; conversation: string; message: string }

async function scenario(org = ORG, sharedSession?: string): Promise<Scenario> {
  const value = { org, contact: randomUUID(), session: sharedSession ?? randomUUID(), conversation: randomUUID(), message: randomUUID() };
  await pool.query(`insert into contacts(id,organization_id,name) values($1,$2,'Contato sintético')`, [value.contact, org]);
  if (sharedSession === undefined) await pool.query(`insert into channel_sessions(id,organization_id,waha_session_name,status,webhook_secret_encrypted)
    values($1,$2,$3,'WORKING','\\x00'::bytea)`, [value.session, org, `recovery-${value.session}`]);
  await pool.query(`insert into conversations(id,organization_id,contact_id,channel_session_id,status,is_group)
    values($1,$2,$3,$4,'ai_handling',false)`, [value.conversation, org, value.contact, value.session]);
  await pool.query(`insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,body,sent_via,sent_at)
    values($1,$2,$3,$4,$5,'text','inbound','delivered','Oi','external_device',$6)`,
  [value.message, org, value.conversation, value.session, value.contact, CLOCK]);
  return value;
}

function harness(mode: 'loop' | 'model-send' = 'loop', outcome: 'sent' | 'failed' | 'throw' = 'sent') {
  const counts = { main: 0, checkpoint: 0, auxiliary: 0 };
  const sent: ChannelSendInput[] = [];
  const logs: Array<{ level: string; message: string; fields: unknown }> = [];
  const doGenerate = async (opts: { tools?: unknown[]; prompt?: unknown }) => {
    if ((opts.tools?.length ?? 0) > 0) {
      counts.main++;
      if (mode === 'loop' || counts.main === 1) return {
        content: [{ type: 'tool-call' as const, toolCallId: `step-${counts.main}`,
          toolName: mode === 'loop' ? 'get_lead_context' : 'send_message',
          input: mode === 'loop' ? '{}' : JSON.stringify({ body: 'Resposta do modelo no teste local.' }) }],
        finishReason: { unified: 'tool-calls' as const, raw: undefined }, usage, warnings: [],
      };
    }
    const text = JSON.stringify(opts.prompt ?? []);
    if (text.includes(CHECKPOINT_INSTRUCTION.slice(0, 50))) counts.checkpoint++;
    else counts.auxiliary++;
    return { content: [{ type: 'text' as const, text: checkpoint }],
      finishReason: { unified: 'stop' as const, raw: undefined }, usage, warnings: [] };
  };
  const handler = createInboundTurnHandler({
    crmCfg: { supabase: {} as never }, llmCfg: { anthropicApiKey: 'offline-no-provider' },
    knobs: { historyLimit: 10, maxContextTokens: 1000, notesIndexMaxTokens: 500,
      maxSteps: MAX_STEPS, maxSendsPerTurn: 2, queuedRetryDelayMs: 1000,
      breaker: { exactFailureWarn: 20, exactFailureBlock: 30, sameToolFailureWarn: 20,
        sameToolFailureHalt: 30, noProgressWarn: 20, noProgressBlock: 30 } },
    registry: createFakeRegistry(doGenerate as never),
    log: Object.fromEntries(['info', 'warn', 'error'].map(level => [level,
      (message: string, fields?: unknown) => logs.push({ level, message, fields })])) as never,
    channel: () => ({
      channel: 'local-capture',
      send: async (input: ChannelSendInput): Promise<ChannelSendResult> => {
        sent.push(input);
        if (outcome === 'throw') throw new Error('synthetic_transport_failure');
        return { kind: outcome, idempotencyKey: `${input.jobId}:${input.seq}`, messageId: randomUUID() };
      },
      sessionHealth: async () => ({ healthy: true, status: 'WORKING' }),
      capabilities: () => ({ freeformAnytime: true, serviceWindowHours: null }),
      costPerMessage: () => ({ currency: 'USD', perMessageUsdCents: 0 }),
    }) as never,
    clock: () => CLOCK, sleep: async () => undefined,
  });
  return { handler, counts, sent, logs };
}

async function run(value: Scenario, h: ReturnType<typeof harness>, conversationId = value.conversation) {
  const { rows: boundaryRows } = await pool.query(`select c.organization_id,c.contact_id,c.id as conversation_id,
    c.service_revision::float8 as service_revision,c.current_demanda_id as demanda_id,d.revision::float8 as demanda_revision
    from conversations c left join demandas d on d.id=c.current_demanda_id and d.organization_id=c.organization_id
    where c.organization_id=$1 and c.id=$2`, [value.org, value.conversation]);
  const { job } = await enqueueJob(pool, value.org, { kind: 'inbound_turn', leadId: value.contact, maxAttempts: 2,
    priority: -1000,
    payload: { conversation_id: conversationId, contact_id: value.contact, channel_session_id: value.session,
      inbound_message_id: value.message, crm_event_id: randomUUID(),
      service_boundary: { ...boundaryRows[0], conversation_id: conversationId } } });
  const worker = `recovery-${job.id}`;
  const [claimed] = await claimJobs(pool, { workerId: worker, maxConcurrency: 100, batchSize: 1 });
  expect(claimed?.id).toBe(job.id);
  let error: unknown = null;
  try {
    await withServiceJob(pool, claimed!, () => h.handler(claimed!, pool, { workerId: worker }));
    await completeJob(pool, job.id, worker);
  } catch (caught) {
    error = caught;
    await failJob(pool, job.id, worker, caught);
  }
  const { rows } = await pool.query<JobRow>('select * from job_queue where organization_id=$1 and id=$2', [value.org, job.id]);
  return { job: rows[0]!, error };
}

async function expectEscalated(value: Scenario) {
  const passagem = await pool.query('select origem,motivo_codigo from passagens_de_atendimento where organization_id=$1 and conversation_id=$2', [value.org, value.conversation]);
  expect(passagem.rows).toEqual([{ origem: 'runtime_nativo', motivo_codigo: 'low_confidence' }]);
  const conversa = await pool.query(`select bot_silenced_until='infinity'::timestamptz as silenced from conversations where organization_id=$1 and id=$2`, [value.org, value.conversation]);
  expect(conversa.rows[0]?.silenced).toBe(true);
  const handoff = await pool.query('select id from agent_inbox_items where organization_id=$1 and kind=$2 and ref_kind=$3 and ref_id=$4', [value.org, 'handoff', 'conversation', value.conversation]);
  expect(handoff.rows).toHaveLength(1);
}

async function calls(jobId: string) {
  const { rows } = await pool.query<{ purpose: string; n: number }>(
    'select purpose,count(*)::int n from llm_calls where job_id=$1 group by purpose', [jobId]);
  return Object.fromEntries(rows.map(row => [row.purpose, row.n]));
}

beforeAll(async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requestedOrigins.add(new URL(url).origin);
    throw new Error('offline_test_network_forbidden');
  }));
  await pool.query(`insert into organizations(id,slug,legal_name,display_name) values
    ($1,'step-recovery-local','Recuperação local','Recuperação local'),
    ($2,'step-recovery-foreign','Outra organização local','Outra organização local') on conflict(id) do nothing`, [ORG, FOREIGN_ORG]);
  await pool.query(`insert into auth.users(id,email) values($1,'step-recovery@invariant.test') on conflict(id) do nothing`, [USER]);
  await pool.query(`insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'admin',now()) on conflict do nothing`, [USER, ORG]);
  await pool.query(`with v as (
    insert into playbook_versions(organization_id,layer,content)
    select null,'platform',E'## Identidade\\nAssistente de teste.'
    where not exists(select 1 from playbook_pointers where organization_id is null and layer='platform') returning id)
    insert into playbook_pointers(organization_id,layer,version_id) select null,'platform',id from v`);
});
beforeEach(async () => {
  // Only this file's synthetic jobs: a previous expected retry must not win
  // the next scenario's real global queue claim after its backoff expires.
  await pool.query("update job_queue set status='done' where organization_id=any($1::uuid[]) and status='pending'", [[ORG, FOREIGN_ORG]]);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await pool.end();
  // Audit may try the DB test config's deliberately closed local endpoint.
  // Never permit a provider or any other external origin, even on a fake path.
  expect([...requestedOrigins].every(origin => origin === 'http://127.0.0.1:1')).toBe(true);
});

describe('real inbound turn: bounded recovery after model-step exhaustion', () => {
  it('ten read steps produce one guarded acknowledgement and one normal checkpoint, without another main generation', async () => {
    const value = await scenario(), h = harness();
    const result = await run(value, h);
    expect(result.error).toBeNull();
    expect(result.job.status).toBe('done');
    expect(h.counts.main).toBe(MAX_STEPS);
    expect(h.counts.checkpoint).toBe(1);
    expect(h.sent.map(message => message.body)).toEqual([STEP_LIMIT_REPLY]);
    expect(await calls(result.job.id)).toMatchObject({ agent_turn: 1, checkpoint: 1 });
    const { rows } = await pool.query('select vetoed_code from before_send_traces where organization_id=$1 and job_id=$2', [ORG, result.job.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vetoed_code).toBeNull();
  });

  it.each(['failed', 'throw'] as const)('a %s fallback hands the conversation to a person: no paid checkpoint or retry', async outcome => {
    const value = await scenario(), h = harness('loop', outcome);
    const result = await run(value, h);
    expect(result.error).toBeNull();
    expect(result.job.status).toBe('done');
    expect(result.job.attempts).toBe(1);
    expect(h.sent[0]?.body).toBe(STEP_LIMIT_REPLY);
    expect(h.counts.main).toBe(MAX_STEPS);
    expect(h.counts.checkpoint).toBe(0);
    expect(await calls(result.job.id)).toEqual({ agent_turn: 1 });
    await expectEscalated(value);
  });

  it('an ordinary model-send failure retains the existing bounded job retry', async () => {
    const value = await scenario(), h = harness('model-send', 'failed');
    const result = await run(value, h);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.job.status).toBe('pending');
    expect(result.job.attempts).toBe(1);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.body).not.toBe(STEP_LIMIT_REPLY);
    expect(h.counts.checkpoint).toBe(0);
  });

  it.each(['current-handoff', 'force-human'] as const)('%s prevents both model and fallback', async state => {
    const value = await scenario(), h = harness();
    if (state === 'current-handoff') await pool.query(`update conversations set bot_silenced_until='infinity',assignee_kind='user',assigned_to_user_id=$3,status='claimed' where organization_id=$1 and id=$2`, [ORG, value.conversation, USER]);
    else await pool.query('update contacts set force_human=true where organization_id=$1 and id=$2', [ORG, value.contact]);
    const result = await run(value, h);
    expect(result.error).toBeNull();
    expect(h.counts.main).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(await calls(result.job.id)).toEqual({});
  });

  it('an already-queued opt-out turn cannot deliver even the neutral fallback', async () => {
    const value = await scenario(), h = harness();
    await pool.query('update contacts set is_blocked=true where organization_id=$1 and id=$2', [ORG, value.contact]);
    const result = await run(value, h);
    expect(result.error).toBeNull();
    expect(result.job.status).toBe('done');
    // This fixture deliberately forces an already-queued job. The existing
    // handler enforces opt-out at before-send; this test proves zero egress.
    expect(h.counts.main).toBe(MAX_STEPS);
    expect(h.sent).toHaveLength(0);
    const { rows } = await pool.query('select vetoed_gate,vetoed_code from before_send_traces where organization_id=$1 and job_id=$2', [ORG, result.job.id]);
    expect(rows).toEqual([{ vetoed_gate: 'stop', vetoed_code: 'contato_bloqueado' }]);
    const accepted = await pool.query("select id from send_ledger where organization_id=$1 and job_id=$2 and status='accepted'", [ORG, result.job.id]);
    expect(accepted.rows).toHaveLength(0);
  });

  it('a foreign-organization conversation cannot reach generation or sending', async () => {
    const own = await scenario(), foreign = await scenario(FOREIGN_ORG), h = harness();
    const result = await run(foreign, h, own.conversation);
    // The database reconstructs the trusted boundary from the inbound
    // message; the mismatched conversation is then rejected as a quiet no-op.
    expect(result.error).toBeNull();
    expect(result.job.status).toBe('done');
    expect(result.job.payload.service_boundary).toMatchObject({ conversation_id: foreign.conversation });
    expect(h.counts.main).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(await calls(result.job.id)).toEqual({});
  });

  it('a silenced sibling in another channel does not stop the current conversation recovery', async () => {
    const value = await scenario(), h = harness();
    const session = randomUUID(), conversation = randomUUID();
    await pool.query(`insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted) values($1,$2,$3,'\\x00'::bytea)`, [session, ORG, `sibling-${session}`]);
    await pool.query(`insert into conversations(id,organization_id,contact_id,channel_session_id,status,assignee_kind,assigned_to_user_id,bot_silenced_until)
      values($1,$2,$3,$4,'closed','user',$5,'infinity')`, [conversation, ORG, value.contact, session, USER]);
    const result = await run(value, h);
    expect(result.error).toBeNull();
    expect(h.counts.main).toBe(MAX_STEPS);
    expect(h.sent.map(message => message.body)).toEqual([STEP_LIMIT_REPLY]);
  });

  it('never leaves a lead silent when the fixed acknowledgement repeats on the same number', async () => {
    // Incidente de produção (2026-10-29): o gate anti-ban conta cópias idênticas em
    // todos os leads do número; a partir do 3º turno esgotado o aviso era vetado e o
    // lead não recebia nada. Todo turno agora termina em resposta ou em passagem.
    const shared = (await scenario()).session;
    const leads: Scenario[] = [];
    for (let i = 0; i < 5; i++) leads.push(await scenario(ORG, shared));
    const outcomes: string[] = [];
    for (const value of leads) {
      const h = harness();
      const result = await run(value, h);
      expect(result.error).toBeNull();
      expect(result.job.status).toBe('done');
      const vetoed = await pool.query("select id from before_send_traces where organization_id=$1 and job_id=$2 and vetoed_code='mass_identical'", [ORG, result.job.id]);
      if (vetoed.rows.length === 0) {
        expect(h.sent.map(message => message.body)).toEqual([STEP_LIMIT_REPLY]);
        outcomes.push('acknowledged');
      } else {
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0]?.body).not.toBe(STEP_LIMIT_REPLY);
        await expectEscalated(value);
        outcomes.push('escalated');
      }
    }
    expect(outcomes).toEqual(['acknowledged', 'acknowledged', 'escalated', 'escalated', 'escalated']);
  });

  it('a second consecutive exhaustion in the same conversation hands off instead of repeating', async () => {
    const value = await scenario();
    const firstHarness = harness();
    const first = await run(value, firstHarness);
    expect(first.error).toBeNull();
    expect(firstHarness.sent.map(message => message.body)).toEqual([STEP_LIMIT_REPLY]);
    // The capture channel does not persist; the real CRM channel writes the
    // outbound row that the next turn's context reads.
    await pool.query(`insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,body,sent_via,sent_at)
      values($1,$2,$3,$4,$5,'text','outbound','sent',$6,'ai',$7)`,
    [randomUUID(), ORG, value.conversation, value.session, value.contact, STEP_LIMIT_REPLY, new Date(CLOCK.getTime() + 30_000)]);
    const message = randomUUID();
    await pool.query(`insert into messages(id,organization_id,conversation_id,channel_session_id,contact_id,type,direction,status,body,sent_via,sent_at)
      values($1,$2,$3,$4,$5,'text','inbound','delivered','Ainda preciso de ajuda','external_device',$6)`,
    [message, ORG, value.conversation, value.session, value.contact, new Date(CLOCK.getTime() + 60_000)]);
    const h = harness();
    const second = await run({ ...value, message }, h);
    expect(second.error).toBeNull();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.body).not.toBe(STEP_LIMIT_REPLY);
    await expectEscalated(value);
  });
});
