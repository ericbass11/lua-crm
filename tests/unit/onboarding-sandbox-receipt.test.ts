import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCtx: vi.fn(),
  patchState: vi.fn(),
  audit: vi.fn(),
  maybeSingle: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("@/app/actions/onboarding/_shared", () => ({
  requireOnboardingCtx: mocks.requireCtx,
  patchOnboardingState: mocks.patchState,
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const query = {
      select: vi.fn(() => query),
      eq: mocks.eq.mockImplementation(() => query),
      maybeSingle: mocks.maybeSingle,
    };
    return { from: vi.fn(() => query) };
  },
}));

import { marcarTesteFeito } from "@/app/actions/onboarding/marcarTeste";

const ctx = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  orgName: "Empresa",
  role: "admin",
};
const receipt = {
  runId: "55555555-5555-4555-8555-555555555555",
  agentId: "33333333-3333-4333-8333-333333333333",
  versionId: "44444444-4444-4444-8444-444444444444",
};

describe("recibo verificável do sandbox do onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCtx.mockResolvedValue(ctx);
    mocks.maybeSingle.mockResolvedValue({
      data: { id: receipt.runId, completed_at: "2026-10-01T00:00:00.000Z" },
      error: null,
    });
  });

  it("grava o recibo somente depois de comprovar run, organização, agente e versão", async () => {
    await expect(marcarTesteFeito(receipt)).rejects.toThrow("NEXT_REDIRECT:/onboarding");

    expect(mocks.eq).toHaveBeenCalledWith("organization_id", ctx.orgId);
    expect(mocks.eq).toHaveBeenCalledWith("agent_id", receipt.agentId);
    expect(mocks.eq).toHaveBeenCalledWith("agent_version_id", receipt.versionId);
    expect(mocks.eq).toHaveBeenCalledWith("is_dry_run", true);
    expect(mocks.eq).toHaveBeenCalledWith("status", "completed");
    expect(mocks.patchState).toHaveBeenCalledWith(ctx.orgId, {
      teste: {
        respondeu: true,
        run_id: receipt.runId,
        agent_id: receipt.agentId,
        version_id: receipt.versionId,
        tested_at: "2026-10-01T00:00:00.000Z",
      },
    });
  });

  it("recusa um run que o banco não consegue comprovar", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(marcarTesteFeito(receipt)).rejects.toThrow("sandbox_run_not_verified");

    expect(mocks.patchState).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("recusa registrar o ensaio feito por quem não é o dono administrador", async () => {
    mocks.requireCtx.mockResolvedValue({ ...ctx, role: "manager" });

    await expect(marcarTesteFeito(receipt)).rejects.toThrow("owner_required");

    expect(mocks.maybeSingle).not.toHaveBeenCalled();
    expect(mocks.patchState).not.toHaveBeenCalled();
  });
});
