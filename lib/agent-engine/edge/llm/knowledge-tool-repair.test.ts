import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import type { ToolSet } from 'ai';
import { z } from 'zod';
import { crmSearchKnowledge } from '@/lib/mcp/tools/evolucao';
import { runModelCall, tool } from './run-model-call';

const PRIVATE_QUERY = 'PRIVATE-QUESTION-DO-NOT-LOG';
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

async function replay(input: string, options: {
  maxSteps?: number;
  maxRetries?: number;
  reservedResponse?: { needed: () => boolean };
  repeatReads?: boolean;
  includeSend?: boolean;
  toolName?: string;
  initialSend?: boolean;
  onSend?: () => void;
  ignoreReservation?: boolean;
} = {}) {
  const execute = vi.fn(async (_input: unknown) => ({ trechos: [{ conteudo: 'Approved source' }] }));
  const send = vi.fn(async (_input: unknown) => { options.onSend?.(); return { ok: true }; });
  let step = 0;
  const model = new MockLanguageModelV3({ doGenerate: async (request) => {
    step++;
    const onlySend = request.tools?.length === 1 && request.tools[0]?.name === 'send_message';
    const finalSend = (onlySend && !options.ignoreReservation) || (step === 1 && options.initialSend);
    return {
      content: finalSend
        ? [{ type: 'tool-call' as const, toolCallId: `send-${step}`, toolName: 'send_message', input: '{"body":"Answer from approved source"}' }]
        : step === 1 || options.repeatReads
          ? [{ type: 'tool-call' as const, toolCallId: `read-${step}`, toolName: options.toolName ?? 'crm_search_knowledge', input }]
          : [{ type: 'text' as const, text: 'Done' }],
      finishReason: { unified: finalSend || step === 1 || options.repeatReads ? 'tool-calls' as const : 'stop' as const, raw: undefined },
      usage, warnings: [],
    };
  } });
  const query = vi.fn(async (sql: string) => sql.includes("settings->'llm'")
    ? { rows: [{ llm: { provider: 'anthropic', default_model: 'mock' } }] }
    : sql.includes('insert into llm_calls') ? { rows: [{ id: 'offline-call' }] } : { rows: [] });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const tools: ToolSet = {
    [options.toolName ?? 'crm_search_knowledge']: tool({ inputSchema: z.object(crmSearchKnowledge.inputSchema), execute }),
  };
  if (options.includeSend !== false)
    tools.send_message = tool({ inputSchema: z.object({ body: z.string() }), execute: send });
  const result = await runModelCall({ query } as never, { anthropicApiKey: 'offline' }, {
    tenantId: '11111111-1111-4111-8111-111111111111', purpose: 'agent_preview',
    messages: [{ role: 'user', content: PRIVATE_QUERY }], tools,
    maxSteps: options.maxSteps ?? 2,
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    ...(options.reservedResponse ? { reservedResponse: options.reservedResponse } : {}),
  }, { registry: { anthropic: () => model }, log });
  return { result, execute, send, model, log };
}

const fetchSpy = vi.fn(async () => { throw new Error('External network forbidden in this test'); });
beforeEach(() => { fetchSpy.mockClear(); vi.stubGlobal('fetch', fetchSpy); });
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('knowledge input recovery through the real SDK, offline', () => {
  it('supports explicit zero retries and rejects out-of-range retry budgets', async () => {
    const result = await replay('{"pergunta":"Synthetic"}', { maxRetries: 0 });
    expect(result.execute).toHaveBeenCalledOnce();
    await expect(replay('{}', { maxRetries: 3 })).rejects.toThrow('llm_invalid_max_retries');
    await expect(replay('{}', { maxRetries: -1 })).rejects.toThrow('llm_invalid_max_retries');
  });
  it('repairs known query aliases and optional nulls before executing the declared read', async () => {
    const r = await replay(JSON.stringify({ query: PRIVATE_QUERY, topK: 5, assistente_id: null }));
    expect(r.execute).toHaveBeenCalledOnce();
    expect(r.execute.mock.calls[0]?.[0]).toEqual({ pergunta: PRIVATE_QUERY, quantidade: 5 });
    expect(r.model.doGenerateCalls).toHaveLength(2);
    expect(r.result.diagnostics.steps[0]?.tools[0]?.status).toBe('completed');
    expect(JSON.stringify(r.log.warn.mock.calls)).not.toContain(PRIVATE_QUERY);
  });
  it('preserves the canonical input, default and explicit assistant identity', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const r = await replay(JSON.stringify({ pergunta: PRIVATE_QUERY, assistente_id: id }));
    expect(r.execute.mock.calls[0]?.[0]).toEqual({ pergunta: PRIVATE_QUERY, quantidade: 5, assistente_id: id });
  });
  it('retains an explicit identity when repairing the read spelling', async () => {
    const id = '22222222-2222-4222-8222-222222222222';
    const r = await replay(JSON.stringify({ query: PRIVATE_QUERY, assistente_id: id }));
    expect(r.execute.mock.calls[0]?.[0]).toEqual({ pergunta: PRIVATE_QUERY, quantidade: 5, assistente_id: id });
  });
  it('never applies this repair to a different, potentially mutating tool', async () => {
    const r = await replay(JSON.stringify({ query: PRIVATE_QUERY }), { toolName: 'crm_delete_contact' });
    expect(r.execute).not.toHaveBeenCalled();
  });
  it('keeps malformed JSON rejected without logging its content', async () => {
    const r = await replay(`{"query":"${PRIVATE_QUERY}`);
    expect(r.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(r.log.warn.mock.calls)).not.toContain(PRIVATE_QUERY);
  });
  it.each([
    { pergunta: null, query: PRIVATE_QUERY },
    { query: PRIVATE_QUERY, unexpected: 'private' },
    { query: PRIVATE_QUERY, topK: 11 },
    { query: PRIVATE_QUERY, assistente_id: 'invalid-id' },
  ])('refuses ambiguous, unknown or schema-invalid inputs: %j', async input => {
    const r = await replay(JSON.stringify(input));
    expect(r.execute).not.toHaveBeenCalled();
    expect(r.result.diagnostics.steps[0]?.tools[0]?.status).toBe('invalid');
    expect(JSON.stringify(r.log.warn.mock.calls)).not.toContain(PRIVATE_QUERY);
  });
});

describe('the final response uses the existing step budget only when requested', () => {
  it('reserves step ten for the normal send tool after nine reads', async () => {
    const r = await replay(JSON.stringify({ pergunta: PRIVATE_QUERY }), {
      maxSteps: 10, repeatReads: true, reservedResponse: { needed: () => true },
    });
    expect(r.model.doGenerateCalls).toHaveLength(10);
    expect(r.execute).toHaveBeenCalledTimes(9);
    expect(r.send).toHaveBeenCalledOnce();
    expect(r.model.doGenerateCalls[9]?.tools?.map(t => t.name)).toEqual(['send_message']);
    // Restricts, never forces: a forced tool choice throws when the model disobeys.
    expect(r.model.doGenerateCalls[9]?.toolChoice?.type).not.toBe('tool');
    expect(r.model.doGenerateCalls[9]?.toolChoice?.type).not.toBe('required');
  });
  it('a model that ignores the reserved step does not throw: the turn ends at the limit', async () => {
    const r = await replay(JSON.stringify({ pergunta: PRIVATE_QUERY }), {
      maxSteps: 10, repeatReads: true, ignoreReservation: true, reservedResponse: { needed: () => true },
    });
    expect(r.send).not.toHaveBeenCalled();
    expect(r.model.doGenerateCalls).toHaveLength(10);
  });
  it('does not force a second response after an earlier accepted send', async () => {
    let accepted = false;
    const r = await replay(JSON.stringify({ pergunta: PRIVATE_QUERY }), {
      maxSteps: 10, repeatReads: true, initialSend: true,
      onSend: () => { accepted = true; }, reservedResponse: { needed: () => !accepted },
    });
    expect(r.send).toHaveBeenCalledOnce();
    expect(r.execute).toHaveBeenCalledTimes(9);
    expect(r.model.doGenerateCalls[9]?.tools?.map(t => t.name)).not.toEqual(['send_message']);
  });
  it.each([
    { maxSteps: 10 },
    { maxSteps: 10, reservedResponse: { needed: () => false } },
    { maxSteps: 1, reservedResponse: { needed: () => true } },
    { maxSteps: 10, reservedResponse: { needed: () => true }, includeSend: false },
  ])('does not force a send without an eligible opt-in: %j', async options => {
    const r = await replay(JSON.stringify({ pergunta: PRIVATE_QUERY }), { ...options, repeatReads: true });
    expect(r.send).not.toHaveBeenCalled();
    expect(r.model.doGenerateCalls).toHaveLength(options.maxSteps);
  });
});
