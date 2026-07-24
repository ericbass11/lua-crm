/**
 * lib/mystery/metrics.ts — cálculo puro das métricas do laudo do Cliente Oculto
 * (testável sem I/O). Benchmarks da Lua são FIXOS (decisão do produto):
 * resposta 3s, atendimento total 5min; projeção de 10 agendamentos/dia.
 */

export const IA_RESPONSE_SECONDS = 3;
export const IA_TOTAL_MINUTES = 5;
export const AGENDAMENTOS_POR_DIA = 10;
export const DIAS_UTEIS_SEMANA = 7; // paridade com o modelo (46h40 = 400min×7)
export const DIAS_MES = 28; // 4 semanas (11.200 = 2.800×4)

export interface TimedMessage {
  direction: "shopper" | "target";
  sent_at: string;
}

export interface ConversationMetrics {
  avgTargetResponseSeconds: number | null;
  totalSeconds: number | null;
  targetMessages: number;
  shopperMessages: number;
}

/**
 * avg de resposta do ALVO = média dos intervalos (mensagem do oculto → próxima
 * resposta do alvo). total = do 1º contato até o horário oferecido (ou última
 * mensagem se não houve).
 */
export function computeConversationMetrics(
  messages: TimedMessage[],
  slotOfferedAt: string | null,
): ConversationMetrics {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
  );
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.direction === "target" && sorted[i - 1]!.direction === "shopper") {
      const dt =
        (new Date(sorted[i]!.sent_at).getTime() - new Date(sorted[i - 1]!.sent_at).getTime()) / 1000;
      if (dt >= 0) gaps.push(dt);
    }
  }
  const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;

  const first = sorted[0]?.sent_at ?? null;
  const endRef = slotOfferedAt ?? sorted[sorted.length - 1]?.sent_at ?? null;
  const totalSeconds =
    first && endRef
      ? Math.max(0, (new Date(endRef).getTime() - new Date(first).getTime()) / 1000)
      : null;

  return {
    avgTargetResponseSeconds: avg,
    totalSeconds,
    targetMessages: sorted.filter((m) => m.direction === "target").length,
    shopperMessages: sorted.filter((m) => m.direction === "shopper").length,
  };
}

export interface OperationalImpact {
  lostMinutesPerService: number;
  dailyLostMinutes: number;
  weeklyLostMinutes: number;
  monthlyLostMinutes: number;
  economyPercent: number;
}

/** Impacto operacional a partir do tempo total (min), com benchmarks Lua. */
export function computeOperationalImpact(totalMinutes: number): OperationalImpact {
  const lost = Math.max(0, totalMinutes - IA_TOTAL_MINUTES);
  const daily = lost * AGENDAMENTOS_POR_DIA;
  return {
    lostMinutesPerService: lost,
    dailyLostMinutes: daily,
    weeklyLostMinutes: daily * DIAS_UTEIS_SEMANA,
    monthlyLostMinutes: daily * DIAS_MES,
    economyPercent: totalMinutes > 0 ? (lost / totalMinutes) * 100 : 0,
  };
}

/** "45 minutos", "6 horas e 40 minutos", "3 segundos". */
export function humanizeMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 1) return "menos de 1 minuto";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} ${m === 1 ? "minuto" : "minutos"}`;
  const hLabel = `${h} ${h === 1 ? "hora" : "horas"}`;
  return m === 0 ? hLabel : `${hLabel} e ${m} ${m === 1 ? "minuto" : "minutos"}`;
}

export function humanizeSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} ${Math.round(seconds) === 1 ? "segundo" : "segundos"}`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  const mLabel = `${mins} ${mins === 1 ? "minuto" : "minutos"}`;
  return secs === 0 ? mLabel : `${mLabel} e ${secs} ${secs === 1 ? "segundo" : "segundos"}`;
}
