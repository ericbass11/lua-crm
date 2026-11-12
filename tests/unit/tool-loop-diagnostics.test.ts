import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { runModelCall, tool } from "@/lib/agent-engine/edge/llm/run-model-call";
import { stepLimitWithoutResponse } from "@/lib/agent-engine/edge/llm/step-diagnostics";

const SECRET = "PRIVATE-CONTENT-DO-NOT-LOG";

async function replay(
  input: string,
  maxSteps = 10,
  mode: "ok" | "reject" | "throw" = "ok",
  toolName = "search_knowledge",
) {
  const execute = vi.fn(async () => {
    if (mode === "throw") throw new Error(SECRET);
    return { ok: mode !== "reject", private_body: SECRET };
  });
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "tool-call", toolCallId: "call", toolName, input }],
      finishReason: { unified: "tool-calls", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("settings->'llm'"))
      return { rows: [{ llm: { provider: "anthropic", default_model: "mock" } }] };
    if (sql.includes("insert into llm_calls")) return { rows: [{ id: "local-call" }] };
    return { rows: [] };
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const call = await runModelCall(
    { query } as never,
    { anthropicApiKey: SECRET },
    {
      tenantId: "11111111-1111-4111-8111-111111111111",
      purpose: "agent_preview",
      messages: [{ role: "user", content: SECRET }],
      maxSteps,
      tools: { search_knowledge: tool({ inputSchema: z.object({ query: z.string() }), execute }) },
    },
    { registry: { anthropic: () => model }, log },
  );
  return { call, execute, model, log };
}

describe("real SDK tool-loop diagnostics, offline", () => {
  it("distinguishes exhausted silence from a response or successful handoff", () => {
    const diagnostics = {
      step_limit_reached: true,
      steps: [
        {
          step: 10,
          finish_reason: "tool-calls" as const,
          tools: [
            { tool_name: "request_human_handoff", status: "completed" as const, error_code: null },
          ],
        },
      ],
    };
    expect(stepLimitWithoutResponse(diagnostics, false)).toBe(false);
    diagnostics.steps[0]!.tools[0]!.tool_name = "search_knowledge";
    expect(stepLimitWithoutResponse(diagnostics, false)).toBe(true);
    expect(stepLimitWithoutResponse(diagnostics, true)).toBe(false);
    expect(stepLimitWithoutResponse({ ...diagnostics, step_limit_reached: false }, false)).toBe(
      false,
    );
  });
  it("redacts unknown model-supplied tool names", async () => {
    const { call, execute } = await replay("{}", 1, "ok", SECRET);
    expect(execute).not.toHaveBeenCalled();
    expect(call.diagnostics.steps[0]?.tools[0]).toEqual({
      tool_name: "unknown_tool",
      status: "invalid",
      error_code: "unknown_tool",
    });
    expect(JSON.stringify(call.diagnostics)).not.toContain(SECRET);
  });
  it("records ten schema-invalid steps although execute never runs", async () => {
    const { call, execute, model, log } = await replay(JSON.stringify({ wrong: SECRET }));
    expect(model.doGenerateCalls).toHaveLength(10);
    expect(execute).not.toHaveBeenCalled();
    expect(call.diagnostics.steps).toHaveLength(10);
    expect(call.diagnostics.step_limit_reached).toBe(true);
    expect(call.diagnostics.steps[0]?.tools).toEqual([
      { tool_name: "search_knowledge", status: "invalid", error_code: "invalid_tool_input" },
    ]);
    expect(JSON.stringify(call.diagnostics)).not.toContain(SECRET);
    expect(JSON.stringify(log.info.mock.calls)).not.toContain(SECRET);
  });
  it.each(["ok", "reject", "throw"] as const)(
    "distinguishes a valid call returning %s",
    async (mode) => {
      const { call, execute } = await replay(JSON.stringify({ query: SECRET }), 1, mode);
      expect(execute).toHaveBeenCalledOnce();
      expect(call.diagnostics.steps[0]?.tools[0]?.status).toBe(
        mode === "ok" ? "completed" : mode === "reject" ? "rejected" : "error",
      );
      expect(JSON.stringify(call.diagnostics)).not.toContain(SECRET);
    },
  );
});
