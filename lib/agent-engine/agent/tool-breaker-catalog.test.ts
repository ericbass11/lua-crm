import { describe, expect, it, vi } from 'vitest';
import { tool } from '../edge/llm/run-model-call';
import { z } from 'zod';
import { generateText, stepCountIs } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { getToolByName } from '@/lib/mcp/tools';
import { READ_ONLY_TOOLS, wrapToolsWithBreaker } from './tool-breaker';

const thresholds = {
  exactFailureWarn: 2, exactFailureBlock: 3,
  sameToolFailureWarn: 2, sameToolFailureHalt: 3,
  noProgressWarn: 2, noProgressBlock: 3,
};

function setup(name: string, result: unknown) {
  const execute = vi.fn(async () => result);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const tools = { [name]: tool({ inputSchema: z.object({ query: z.string() }), execute }) };
  const wrapped = wrapToolsWithBreaker(tools, {
    thresholds,
    readOnlyTools: [...READ_ONLY_TOOLS, ...Object.keys(tools).filter(n => getToolByName(n)?.category === 'read')],
    isDeclaredEmptyResult: (n, value) => getToolByName(n)?.motivoDoVazio?.(value) != null,
    log,
  });
  return { execute, log, tools: wrapped, call: (query: string) => wrapped[name]!.execute!({ query }, { toolCallId: 'test', messages: [], context: undefined }) };
}

describe('catalog reads share the loop breaker', () => {
  it('replays five model-selected empty product queries with the real SDK offline', async () => {
    const { execute, tools } = setup('crm_search_products', { produtos: [], motivo: 'nao_encontrado' });
    let step = 0;
    const model = new MockLanguageModelV3({ doGenerate: async () => {
      step++;
      return {
        content: step <= 5
          ? [{ type: 'tool-call' as const, toolCallId: `call-${step}`, toolName: 'crm_search_products', input: JSON.stringify({ query: `query ${step}` }) }]
          : [{ type: 'text' as const, text: 'Não há resultado suficiente para orientar.' }],
        finishReason: { unified: step <= 5 ? 'tool-calls' as const : 'stop' as const, raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      };
    } });
    const result = await generateText({ model, tools, messages: [{ role: 'user', content: 'Oi' }], stopWhen: stepCountIs(6) });
    expect(model.doGenerateCalls).toHaveLength(6);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(result.text).toBe('Não há resultado suficiente para orientar.');
    expect(result.steps[4]?.toolResults[0]?.output).toMatchObject({ ok: false, error: { code: 'circuit_breaker_same_tool' } });
  });
  it('halts five empty product searches even with different arguments', async () => {
    const { execute, call, log } = setup('crm_search_products', { produtos: [], motivo: 'nao_encontrado' });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await call(`private query ${i}`));
    expect(execute).toHaveBeenCalledTimes(3);
    expect(results[0]).toEqual({ produtos: [], motivo: 'nao_encontrado' });
    expect(results[4]).toMatchObject({ ok: false, error: { code: 'circuit_breaker_same_tool' } });
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('private query');
  });

  it('does not treat arbitrary motivo fields as failures without a declaration', async () => {
    const { execute, call } = setup('crm_get_contact', { motivo: 'informacao', nome: 'Cliente' });
    for (let i = 0; i < 5; i++) await call(`query ${i}`);
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it('blocks repeated successful catalog reads without progress', async () => {
    const { execute, call } = setup('crm_get_contact', { nome: 'Cliente' });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await call('same'));
    expect(execute).toHaveBeenCalledTimes(3);
    expect(results[4]).toMatchObject({ ok: false, error: { code: 'circuit_breaker_no_progress' } });
  });

  it('does not apply read-only no-progress rules to send_message', async () => {
    const { execute, call } = setup('send_message', { ok: true });
    for (let i = 0; i < 5; i++) await call('same');
    expect(execute).toHaveBeenCalledTimes(5);
  });
});
