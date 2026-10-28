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

  it('notifies instead of bypassing a stale service or human takeover', async () => {
    const { input, run } = recovery({ send: vi.fn(async () => { throw new Error('stale_boundary'); }) });
    expect(await run()).toBe('unresolved');
    expect(input.send).toHaveBeenCalledOnce();
    expect(input.notify).toHaveBeenCalledOnce();
  });
});

