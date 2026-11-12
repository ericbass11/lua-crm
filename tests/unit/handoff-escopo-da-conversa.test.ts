import { describe, expect, it, vi } from "vitest";
import { isLeadInHandoff } from "@/lib/agent-engine/agent/human-handoff";

describe("handoff exige identificar a conversa atual", () => {
  it("envia organização, contato e conversa à consulta, sem inferir outra conversa", async () => {
    const query = vi.fn(async (_sql: string, _values: unknown[]) => ({
      rows: [{ handoff: false }],
    }));
    expect(await isLeadInHandoff({ query } as never, "org", "contato", "conversa-atual")).toBe(
      false,
    );
    expect(query.mock.calls[0]?.[1]).toEqual(["org", "contato", "conversa-atual"]);
  });
  it("falha fechado se a combinação de organização, contato e conversa não existir", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    expect(await isLeadInHandoff({ query } as never, "org", "contato", "inexistente")).toBe(true);
  });
  it("não libera a IA quando o chamador não fornece uma conversa", async () => {
    const query = vi.fn(async () => ({ rows: [{ handoff: false }] }));
    expect(await isLeadInHandoff({ query } as never, "org", "contato", "")).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
});
