// @vitest-environment node
import { describe, expect, it } from "vitest";

import { renderReportPdf, renderTranscriptPdf } from "./pdf";

describe("mystery PDF render", () => {
  it("renderiza o laudo para Buffer", async () => {
    const buf = await renderReportPdf({
      targetName: "Diquali Odontologia",
      dateLabel: "Segunda-feira, 09/12/2025 (Início 09:49; Término 10:34)",
      attendantName: "Não informado",
      targetAvgResponseLabel: "5 minutos e 14 segundos",
      totalLabel: "45 minutos",
      qualityIssues: [
        { quote: "Nos agendamos avaliação por aqui sim", problem: "Concordância verbal.", suggestion: "Nós agendamos avaliações por aqui, sim." },
      ],
      impact: {
        lostPerServiceLabel: "40 minutos",
        dailyLabel: "6 horas e 40 minutos",
        weeklyLabel: "46 horas e 40 minutos",
        monthlyLabel: "186 horas e 40 minutos",
        economyPercent: "88,89",
      },
      conclusion: "Conclusão de teste.",
    });
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("renderiza a transcrição para Buffer", async () => {
    const buf = await renderTranscriptPdf({
      targetName: "Diquali Odontologia",
      lines: [
        { at: "09/12 09:49", role: "Paciente", text: "Oi! Gostaria de agendar." },
        { at: "09/12 10:10", role: "Clínica", text: "Nos agendamos avaliação por aqui sim" },
      ],
    });
    expect(buf.length).toBeGreaterThan(1000);
  });
});
