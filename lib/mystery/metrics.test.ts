/**
 * Tests for lib/mystery/metrics.ts — casa os números do modelo (Cliente Oculto
 * 09/12): total 45min → perda 40, dia 400, semana 2.800, mês 11.200, economia
 * 88,89%. Também cobre o cálculo de tempo médio/total e os humanizadores.
 */
import { describe, expect, it } from "vitest";

import {
  computeConversationMetrics,
  computeOperationalImpact,
  humanizeMinutes,
  humanizeSeconds,
} from "./metrics";

describe("computeOperationalImpact (benchmarks Lua fixos)", () => {
  it("reproduz o modelo: total 45min", () => {
    const i = computeOperationalImpact(45);
    expect(i.lostMinutesPerService).toBe(40);
    expect(i.dailyLostMinutes).toBe(400);
    expect(i.weeklyLostMinutes).toBe(2800);
    expect(i.monthlyLostMinutes).toBe(11200);
    expect(i.economyPercent.toFixed(2)).toBe("88.89");
  });

  it("não fica negativo quando o atendimento é rápido", () => {
    const i = computeOperationalImpact(3);
    expect(i.lostMinutesPerService).toBe(0);
    expect(i.economyPercent).toBe(0);
  });
});

describe("computeConversationMetrics", () => {
  it("média de resposta do alvo = intervalos shopper→target; total = 1º→slot", () => {
    const base = Date.parse("2025-12-09T10:00:00Z");
    const at = (mins: number) => new Date(base + mins * 60_000).toISOString();
    const msgs = [
      { direction: "shopper" as const, sent_at: at(0) },
      { direction: "target" as const, sent_at: at(5) }, // gap 300s
      { direction: "shopper" as const, sent_at: at(6) },
      { direction: "target" as const, sent_at: at(10) }, // gap 240s
    ];
    const m = computeConversationMetrics(msgs, at(10));
    expect(m.avgTargetResponseSeconds).toBe(270); // (300+240)/2
    expect(m.totalSeconds).toBe(600); // 10 min
    expect(m.targetMessages).toBe(2);
    expect(m.shopperMessages).toBe(2);
  });

  it("sem par shopper→target, média é null", () => {
    const m = computeConversationMetrics(
      [{ direction: "shopper", sent_at: new Date().toISOString() }],
      null,
    );
    expect(m.avgTargetResponseSeconds).toBeNull();
  });
});

describe("humanizadores", () => {
  it("minutos", () => {
    expect(humanizeMinutes(45)).toBe("45 minutos");
    expect(humanizeMinutes(400)).toBe("6 horas e 40 minutos");
    expect(humanizeMinutes(2800)).toBe("46 horas e 40 minutos");
    expect(humanizeMinutes(11200)).toBe("186 horas e 40 minutos");
    expect(humanizeMinutes(60)).toBe("1 hora");
  });

  it("segundos", () => {
    expect(humanizeSeconds(3)).toBe("3 segundos");
    expect(humanizeSeconds(314)).toBe("5 minutos e 14 segundos");
  });
});
