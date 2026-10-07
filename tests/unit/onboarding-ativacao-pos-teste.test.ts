import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCtx: vi.fn(),
  loadState: vi.fn(),
  publish: vi.fn(),
  audit: vi.fn(),
  patchState: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/app/actions/onboarding/_shared", () => ({
  requireOnboardingCtx: mocks.requireCtx,
  loadOnboardingState: mocks.loadState,
  patchOnboardingState: mocks.patchState,
  OnboardingError: class OnboardingError extends Error {},
}));
vi.mock("@/lib/ai/agents/publish", () => ({ publishAgentVersion: mocks.publish }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ insert: vi.fn(async () => ({ error: null })) }),
  }),
}));

import { ativarAgenteDoOnboarding } from "@/app/actions/onboarding/ativarAgente";

const ctx = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  orgName: "Empresa",
  role: "admin",
  fullName: "Dono",
  email: "dono@example.test",
};

describe("ativação explícita do agente no onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCtx.mockResolvedValue(ctx);
    mocks.loadState.mockResolvedValue({
      state: {
        ai: { agent_id: "33333333-3333-4333-8333-333333333333", prompt_template: "p" },
        teste: {
          respondeu: true,
          run_id: "55555555-5555-4555-8555-555555555555",
          agent_id: "33333333-3333-4333-8333-333333333333",
          version_id: "44444444-4444-4444-8444-444444444444",
          tested_at: "2026-10-01T00:00:00.000Z",
        },
      },
      onboardedAt: null,
    });
    mocks.publish.mockResolvedValue({
      ok: true,
      agent_id: "33333333-3333-4333-8333-333333333333",
      version_id: "44444444-4444-4444-8444-444444444444",
      previous_version_id: null,
      published_at: "2026-10-01T00:00:00.000Z",
    });
  });

  it("recusa ativar antes de uma resposta bem-sucedida no sandbox", async () => {
    mocks.loadState.mockResolvedValue({
      state: {
        ai: { agent_id: "33333333-3333-4333-8333-333333333333", prompt_template: "p" },
        teste: { respondeu: false },
      },
      onboardedAt: null,
    });

    const result = await ativarAgenteDoOnboarding("44444444-4444-4444-8444-444444444444");

    expect(result).toEqual({ ok: false, error: "sandbox_required" });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("recusa qualquer papel que não seja o dono administrador", async () => {
    mocks.requireCtx.mockResolvedValue({ ...ctx, role: "manager" });

    const result = await ativarAgenteDoOnboarding("44444444-4444-4444-8444-444444444444");

    expect(result).toEqual({ ok: false, error: "owner_required" });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("recusa publicar uma versão diferente daquela comprovada pelo sandbox", async () => {
    const result = await ativarAgenteDoOnboarding("66666666-6666-4666-8666-666666666666");

    expect(result).toEqual({ ok: false, error: "sandbox_required" });
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("publica somente no clique explícito do dono e deixa trilha de auditoria", async () => {
    await expect(
      ativarAgenteDoOnboarding("44444444-4444-4444-8444-444444444444"),
    ).rejects.toThrow("NEXT_REDIRECT:/onboarding");

    expect(mocks.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: ctx.orgId,
        agentId: "33333333-3333-4333-8333-333333333333",
        versionId: "44444444-4444-4444-8444-444444444444",
        expectedProvenance: "onboarding",
      }),
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_agent.published",
        actorUserId: ctx.userId,
        organizationId: ctx.orgId,
        resourceId: "33333333-3333-4333-8333-333333333333",
      }),
    );
    expect(mocks.patchState).toHaveBeenCalledWith(ctx.orgId, {
      ativacao: {
        agent_id: "33333333-3333-4333-8333-333333333333",
        version_id: "44444444-4444-4444-8444-444444444444",
        activated_at: "2026-10-01T00:00:00.000Z",
      },
    });
  });
});
