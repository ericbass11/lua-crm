/** A bounded acknowledgement through the caller's normal guarded send path. */
export const STEP_LIMIT_REPLY = 'Não consegui concluir esta resposta agora.';

/** What the person taking over reads in the handoff briefing (never sent to the lead). */
export const STEP_LIMIT_HANDOFF_TEXT =
  'A IA atingiu o limite de etapas sem conseguir responder ao cliente. Leia a última mensagem e responda.';

/** Only a new delivery failure of this bounded acknowledgement is terminal here. */
export function fallbackDeliveryIsTerminal(input: {
  attempted: boolean;
  priorFailure: boolean;
  recovery: 'not_needed' | 'accepted' | 'escalated' | 'unresolved';
  hasRunError: boolean;
  outcomeKinds: readonly string[];
}): boolean {
  return input.attempted && !input.priorFailure && input.recovery === 'unresolved'
    && (input.hasRunError || input.outcomeKinds.some(kind => kind === 'failed' || kind === 'unavailable'))
    && !input.outcomeKinds.some(kind => ['sent', 'already_sent', 'queued', 'blocked'].includes(kind));
}

/**
 * The acknowledgement is a fixed text, and the spinning gate counts identical
 * copies across every lead of the number: from the third one on it is vetoed,
 * and a vetoed acknowledgement used to end the turn in silence. When the
 * acknowledgement cannot be delivered — or the previous turn of the same
 * conversation already ended in it — `escalate` hands the conversation to a
 * person through the escalation notice, which is the path built to survive
 * that gate. Earlier failures/impediments keep their own policy.
 */
export async function recoverStepLimit(input: {
  exhausted: boolean;
  canSpeak: boolean;
  hasImpediment: boolean;
  attemptedSend: boolean;
  /** The previous bot turn of this conversation was already this acknowledgement. */
  repeatedExhaustion?: boolean;
  send: (body: string) => Promise<boolean>;
  /** Hands the conversation to a person; `true` once the handoff is recorded. */
  escalate?: () => Promise<boolean>;
  notify: () => Promise<void>;
}): Promise<'not_needed' | 'accepted' | 'escalated' | 'unresolved'> {
  if (!input.exhausted || !input.canSpeak) return 'not_needed';
  if (!input.hasImpediment && !input.attemptedSend && !input.repeatedExhaustion) {
    try {
      if (await input.send(STEP_LIMIT_REPLY)) return 'accepted';
    } catch {
      // A denied/stale execution is never forced or retried here.
    }
  }
  if (!input.hasImpediment && input.escalate) {
    try {
      if (await input.escalate()) return 'escalated';
    } catch {
      // Falls through to the notice: the alert is the floor, never silence.
    }
  }
  await input.notify();
  return 'unresolved';
}
