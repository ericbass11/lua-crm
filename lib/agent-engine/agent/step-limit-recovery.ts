/** A bounded acknowledgement through the caller's normal guarded send path. */
export const STEP_LIMIT_REPLY = 'Não consegui concluir esta resposta agora.';

/** Only a new delivery failure of this bounded acknowledgement is terminal here. */
export function fallbackDeliveryIsTerminal(input: {
  attempted: boolean;
  priorFailure: boolean;
  recovery: 'not_needed' | 'accepted' | 'unresolved';
  hasRunError: boolean;
  outcomeKinds: readonly string[];
}): boolean {
  return input.attempted && !input.priorFailure && input.recovery === 'unresolved'
    && (input.hasRunError || input.outcomeKinds.some(kind => kind === 'failed' || kind === 'unavailable'))
    && !input.outcomeKinds.some(kind => ['sent', 'already_sent', 'queued', 'blocked'].includes(kind));
}

export async function recoverStepLimit(input: {
  exhausted: boolean;
  canSpeak: boolean;
  hasImpediment: boolean;
  attemptedSend: boolean;
  send: (body: string) => Promise<boolean>;
  notify: () => Promise<void>;
}): Promise<'not_needed' | 'accepted' | 'unresolved'> {
  if (!input.exhausted || !input.canSpeak) return 'not_needed';
  if (!input.hasImpediment && !input.attemptedSend) {
    try {
      if (await input.send(STEP_LIMIT_REPLY)) return 'accepted';
    } catch {
      // A denied/stale execution is never forced or retried here.
    }
  }
  await input.notify();
  return 'unresolved';
}
