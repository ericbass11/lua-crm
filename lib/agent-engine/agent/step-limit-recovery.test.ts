import { describe, expect, it, vi } from 'vitest';
import { recoverStepLimit, STEP_LIMIT_REPLY, fallbackDeliveryIsTerminal } from './step-limit-recovery';

function recovery(overrides: Partial<Parameters<typeof recoverStepLimit>[0]> = {}) {
  const input = {
    exhausted: true, canSpeak: true, hasImpediment: false, attemptedSend: false,
    send: vi.fn(async () => true), notify: vi.fn(async () => undefined), ...overrides,
  };
  return { input, run: () => recoverStepLimit(input) };
}

describe('bounded step-limit recovery', () => {
  it('only terminates a failed fallback; ordinary failures and accepted/deferred/vetoed outcomes retain their policy', () => {
    const failure = { attempted: true, priorFailure: false, recovery: 'unresolved' as const, hasRunError: true, outcomeKinds: ['failed'] };
    expect(fallbackDeliveryIsTerminal(failure)).toBe(true);
    expect(fallbackDeliveryIsTerminal({ ...failure, priorFailure: true })).toBe(false);
    expect(fallbackDeliveryIsTerminal({ ...failure, attempted: false })).toBe(false);
    expect(fallbackDeliveryIsTerminal({ ...failure, recovery: 'accepted' })).toBe(false);
    for (const kind of ['sent', 'already_sent', 'queued', 'blocked'])
      expect(fallbackDeliveryIsTerminal({ ...failure, outcomeKinds: [kind] })).toBe(false);
    expect(fallbackDeliveryIsTerminal({ ...failure, hasRunError: false, outcomeKinds: [] })).toBe(false);
  });
  it('uses exactly one guarded acknowledgement instead of another model generation', async () => {
    const { input, run } = recovery();
    expect(await run()).toBe('accepted');
    expect(input.send).toHaveBeenCalledExactlyOnceWith(STEP_LIMIT_REPLY);
    expect(input.notify).not.toHaveBeenCalled();
  });

  it.each([{ exhausted: false }, { canSpeak: false }])('does nothing for %j', async (overrides) => {
    const { input, run } = recovery(overrides);
    expect(await run()).toBe('not_needed');
    expect(input.send).not.toHaveBeenCalled();
    expect(input.notify).not.toHaveBeenCalled();
  });

  it.each([{ hasImpediment: true }, { attemptedSend: true }])('does not override an earlier veto/send attempt: %j', async (overrides) => {
    const { input, run } = recovery(overrides);
    expect(await run()).toBe('unresolved');
    expect(input.send).not.toHaveBeenCalled();
    expect(input.notify).toHaveBeenCalledOnce();
  });

  it('notifies instead of retrying when the guarded send refuses', async () => {
    const { input, run } = recovery({ send: vi.fn(async () => false) });
    expect(await run()).toBe('unresolved');
    expect(input.send).toHaveBeenCalledOnce();
    expect(input.notify).toHaveBeenCalledOnce();
  });

  describe('escalation when the acknowledgement cannot reach the lead', () => {
    it('hands off to a person when the guarded send refuses (e.g. spinning veto)', async () => {
      const escalate = vi.fn(async () => true);
      const { input, run } = recovery({ send: vi.fn(async () => false), escalate });
      expect(await run()).toBe('escalated');
      expect(input.send).toHaveBeenCalledOnce();
      expect(escalate).toHaveBeenCalledOnce();
      expect(input.notify).not.toHaveBeenCalled();
    });

    it('hands off when the send throws', async () => {
      const escalate = vi.fn(async () => true);
      const { run } = recovery({ send: vi.fn(async () => { throw new Error('stale_boundary'); }), escalate });
      expect(await run()).toBe('escalated');
    });

    it('skips the repeated acknowledgement and hands off on a second consecutive exhaustion', async () => {
      const escalate = vi.fn(async () => true);
      const { input, run } = recovery({ repeatedExhaustion: true, escalate });
      expect(await run()).toBe('escalated');
      expect(input.send).not.toHaveBeenCalled();
    });

    it('hands off when the model attempted a send that never got through', async () => {
      const escalate = vi.fn(async () => true);
      const { input, run } = recovery({ attemptedSend: true, escalate });
      expect(await run()).toBe('escalated');
      expect(input.send).not.toHaveBeenCalled();
    });

    it('keeps the first accepted acknowledgement without escalating', async () => {
      const escalate = vi.fn(async () => true);
      const { run } = recovery({ escalate });
      expect(await run()).toBe('accepted');
      expect(escalate).not.toHaveBeenCalled();
    });

    it.each([{ hasImpediment: true }, { canSpeak: false }])('never escalates over %j', async (overrides) => {
      const escalate = vi.fn(async () => true);
      const { run } = recovery({ ...overrides, escalate });
      await run();
      expect(escalate).not.toHaveBeenCalled();
    });

    it('falls back to the notice when the handoff itself fails', async () => {
      const { input, run } = recovery({
        send: vi.fn(async () => false), escalate: vi.fn(async () => { throw new Error('db'); }),
      });
      expect(await run()).toBe('unresolved');
      expect(input.notify).toHaveBeenCalledOnce();
    });

    it('an escalated turn is never treated as a terminal fallback failure', () => {
      expect(fallbackDeliveryIsTerminal({
        attempted: true, priorFailure: false, recovery: 'escalated', hasRunError: true, outcomeKinds: ['failed'],
      })).toBe(false);
    });
  });

  it('notifies instead of bypassing a stale service or human takeover', async () => {
    const { input, run } = recovery({ send: vi.fn(async () => { throw new Error('stale_boundary'); }) });
    expect(await run()).toBe('unresolved');
    expect(input.send).toHaveBeenCalledOnce();
    expect(input.notify).toHaveBeenCalledOnce();
  });
});

