import { describe, expect, it } from "vitest";

import { intencaoDoJob } from "./send-message";

describe("intenção confiável do job de agente", () => {
  it("vincula inbound_turn ao id da mensagem recebida", () => {
    expect(
      intencaoDoJob({
        kind: "inbound_turn",
        payload: { inbound_message_id: "11111111-1111-4111-8111-111111111111" },
      }),
    ).toEqual({
      kind: "inbound_reply",
      inboundMessageId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("não promove inbound sem comprovante", () => {
    expect(intencaoDoJob({ kind: "inbound_turn", payload: {} })).toEqual({
      kind: "system_outbound",
    });
  });

  it("classifica follow-up como saída proibida no perfil", () => {
    expect(intencaoDoJob({ kind: "followup_turn", payload: {} })).toEqual({ kind: "followup" });
  });

  it("preserva a continuidade do handoff humano", () => {
    expect(intencaoDoJob({ kind: "case_reply_turn", payload: {} })).toEqual({
      kind: "human_handoff",
    });
  });
});
