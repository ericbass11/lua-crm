/**
 * Independent review: route status and actual SDK metadata mapping.
 * Sandbox is mocked; no provider, WhatsApp or database network is used.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";
import { testAgentVersion } from "@/lib/agent-engine/agent/sandbox";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/agent-engine/agent/sandbox", () => ({
  testAgentVersion: vi.fn(async () => {
    throw new Error("AI_GATEWAY_API_KEY ausente");
  }),
}));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({ requestTurnDeps: vi.fn() }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: vi.fn() }));

const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const AGENT = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";

function stubAdmin(atualizacoes: Record<string, unknown>[]) {
  return {
    from: (table: string) => {
      if (table === "ai_agent_versions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: VERSION,
                      agent_id: AGENT,
                      organization_id: ORG,
                      system_prompt: "oi",
                      provider: "anthropic",
                      model: "claude-sonnet-4-6",
                      channel_session_id: null,
                      max_steps: 3,
                      token_budget: 1000,
                      cost_budget_cents: 100,
                      tool_ids: [],
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      // ai_agent_runs
      return {
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: "run-1" }, error: null }) }),
        }),
        update: (payload: Record<string, unknown>) => {
          atualizacoes.push(payload);
          const chain = {
            eq: () => chain,
            then: (ok: (value: { error: null }) => unknown) =>
              Promise.resolve({ error: null }).then(ok),
          };
          return chain;
        },
      };
    },
  };
}

describe("Independent review: preview diagnostics route", () => {
  const atualizacoes: Record<string, unknown>[] = [];
  const requestPool = { query: vi.fn() };
  const turnDeps = {};

  beforeEach(() => {
    vi.clearAllMocks();
    atualizacoes.length = 0;
    const user: AuthUser = {
      id: USER,
      email: "a@example.com",
      full_name: null,
      avatar_url: null,
      is_platform_admin: false,
      idioma: "pt-BR" as const,
      organizations: [{ organization_id: ORG, organization_name: "Org", role: "admin" }],
    };
    vi.mocked(requireRole).mockImplementation(async (min: Role) =>
      ROLE_RANK["admin"] >= ROLE_RANK[min]
        ? { ok: true, user, org: { orgId: ORG, name: "Org", role: "admin" } }
        : ({ ok: false, response: null } as never),
    );
    vi.mocked(createAdminClient).mockReturnValue(stubAdmin(atualizacoes) as never);
    vi.mocked(getRequestPool).mockReturnValue(requestPool as never);
    vi.mocked(requestTurnDeps).mockReturnValue(turnDeps as never);
  });

  it.each([
    { fallbackResponse: false, name: "ceiling with no response", candidates: [], impediments: [{code: "step_limit_without_response", message: "limit"}], status: "failed", dbStatus: "failed" },
    { fallbackResponse: false, name: "legitimate veto", candidates: [], impediments: [{code: "opted_out", message: "veto"}], status: "blocked", dbStatus: "completed" },
    { fallbackResponse: false, name: "candidate wins over stale ceiling impediment", candidates: [{body: "Resposta segura", citations: [], trace: []}], impediments: [{code: "step_limit_without_response", message: "limit"}], status: "ok", dbStatus: "completed" },
    { fallbackResponse: false, name: "valid candidate", candidates: [{body: "Resposta segura", citations: [], trace: []}], impediments: [], status: "ok", dbStatus: "completed" },
    { fallbackResponse: true, name: "fallback remains a failed completion", candidates: [{body: "Não consegui concluir esta resposta agora.", citations: [], trace: []}], impediments: [{code: "step_limit_without_response", message: "limit"}], status: "failed", dbStatus: "failed" },
  ])("classifies $name and persists real tool metadata", async ({ candidates, impediments, status, dbStatus, fallbackResponse }) => {
    const diagnostics = {
      step_limit_reached: true,
      steps: [{step: 1, finish_reason: "tool-calls" as const, tools: [{tool_name: "search_knowledge", status: "invalid" as const, error_code: "invalid_tool_input" as const}]}],
    };
    vi.mocked(testAgentVersion).mockResolvedValueOnce({
      candidates, impediments, restrictions: [], fallback_response: fallbackResponse,
      proposals: [{tool: "proposal-is-not-sdk-trace", arguments: {private: "PRIVATE_SENTINEL"}}],
      model_diagnostics: diagnostics,
    });
    const { POST } = await import("./route");
    const res = await POST(new NextRequest("http://localhost/x", {
      method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({sample_message: "oi"}),
    }), {params: Promise.resolve({id: AGENT, vid: VERSION})});
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.status).toBe(status);
    expect(body.data.tool_calls).toEqual([{step: 1, tool_name: "search_knowledge", result: {status: "invalid", finish_reason: "tool-calls"}, error: "invalid_tool_input"}]);
    expect(JSON.stringify(body.data.tool_calls)).not.toContain("PRIVATE_SENTINEL");
    expect(atualizacoes).toHaveLength(1);
    expect(atualizacoes[0]).toMatchObject({status: dbStatus, steps_count: 1, tool_calls: body.data.tool_calls, error_code: status === "failed" ? "step_limit_without_response" : null});
    expect(testAgentVersion).toHaveBeenCalledTimes(1);
  });
});

// Este teste isola o handler; autoridade de suporte é exercitada na suíte própria.
vi.mock("@/lib/impersonate/support", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/impersonate/support")>(),
  requireSupportWrite: vi.fn(async () => null),
  authenticatedSessionId: vi.fn(async () => "f2200000-0000-4000-8000-000000000099"),
}));

