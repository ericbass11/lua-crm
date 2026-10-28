import { recoverStepLimit, STEP_LIMIT_REPLY } from './step-limit-recovery';
import { DEFAULT_CHANNEL_PROVIDER } from '@/lib/channels';
import { describe, it, expect, vi } from 'vitest';
import { tool } from '../edge/llm/run-model-call';
import { z } from 'zod';
import { applyPreviewPolicy, newPreviewResult, scenarioContext, type TurnPreview } from './preview';
import { evaluateBeforeSend, type GateContext } from '../guardrails/before-send';
import { PACING_DEFAULTS } from '../pacing/defaults';
import { SPINNING_DEFAULTS } from '../spinning/defaults';
const gate = (): GateContext => ({
  now: new Date('2026-09-07T15:00:00Z'),
  body: 'Olá, posso ajudar?',
  optedOut: false,
  provider: DEFAULT_CHANNEL_PROVIDER,
  messagingWindow: { lastInboundAt: new Date('2026-09-07T14:00:00Z') },
  pacing: {
    knobs: PACING_DEFAULTS,
    state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
    crmDailyLimit: null,
  },
  spinning: { knobs: SPINNING_DEFAULTS, window: [] },
  promise: { table: null },
  semanticPromise: null,
  disclosure: { template: null, isFirstOutbound: false, mode: 'inject' },
  lgpd: null,
  casesEnabled: false,
  hasOpenCase: false,
  openedCaseThisTurn: false,
});
const preview = () =>
  ({
    kind: 'sandbox',
    organizationId: 'real-org',
    runId: 'preview-run',
    contactId: null,
    channelId: null,
    agent: {},
    context: scenarioContext([]),
    result: newPreviewResult(),
  }) as TurnPreview;
const definition = (execute: (args: unknown) => unknown) =>
  tool({
    inputSchema: z.object({ body: z.string().optional() }),
    execute: async (args) => execute(args),
  });
async function execute(t: ReturnType<typeof applyPreviewPolicy>, name: string, args: unknown = {}) {
  return t[name]!.execute!(args, { toolCallId: 'test', messages: [], context: undefined });
}

describe('independent recovery through real sandbox send policy', () => {
  async function run(optedOut: boolean, hasImpediment = false) {
    const p = preview();
    const operationalSend = vi.fn();
    const notify = vi.fn(async () => undefined);
    const tools = applyPreviewPolicy({send_message: definition(operationalSend)}, p,
      {...gate(), optedOut}, () => []);
    const outcome = await recoverStepLimit({
      exhausted: true, canSpeak: true, hasImpediment, attemptedSend: false,
      send: async body => {
        const result = await execute(tools, 'send_message', {body});
        return !!result && typeof result === 'object' && 'ok' in result && result.ok === true;
      }, notify,
    });
    return {p, operationalSend, notify, outcome};
  }
  it('creates a safe candidate using the actual gates without an operational send', async () => {
    const {p, operationalSend, notify, outcome} = await run(false);
    expect(outcome).toBe('accepted');
    expect(p.result.candidates).toHaveLength(1);
    expect(p.result.candidates[0]?.body).toContain(STEP_LIMIT_REPLY);
    expect(operationalSend).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it('keeps real opt-out veto and notifies instead of bypassing', async () => {
    const {p, operationalSend, notify, outcome} = await run(true);
    expect(outcome).toBe('unresolved');
    expect(p.result.candidates).toHaveLength(0);
    expect(p.result.impediments[0]?.code).toBe(evaluateBeforeSend({...gate(), optedOut: true}).veto?.code);
    expect(operationalSend).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
  });
  it('preserves an existing impediment without even simulating another send', async () => {
    const {p, operationalSend, notify, outcome} = await run(false, true);
    expect(outcome).toBe('unresolved');
    expect(p.result.candidates).toHaveLength(0);
    expect(operationalSend).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
  });
});
