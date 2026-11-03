/**
 * #923 — ARQUIVAR CONVERSA (e não excluir).
 *
 * Prova, contra o Route Handler REAL de `PATCH /api/v1/conversations/[id]`
 * (auth, Supabase e auditoria mockados):
 *
 *  - arquivar (`status: "archived"`) chega ao banco pela MESMA porta de tudo
 *    que mexe em estado de atendimento — `fn_service_status`, com lock
 *    otimista — e deixa evento PRÓPRIO, `conversation.archived`;
 *  - fechar continua auditando `conversation.closed` (o ternário de auditoria
 *    ganhou um ramo; não trocou o que já existia);
 *  - a revisão esperada viaja para a RPC (`p_expected`): é ela que transforma
 *    "clique em tela velha" em 409, e não em arquivamento silencioso;
 *  - PT409 e 40001 legado da RPC → 409 e NENHUM evento: a auditoria só existe para o que
 *    aconteceu de verdade;
 *  - quem não tem escrita de suporte (`requireSupportWrite`) não chega a
 *    chamar a RPC nem a auditar;
 *  - `resolved`/`excluida` NÃO são graváveis pela API (422): o vocabulário
 *    terminal é fechado de propósito — é o que impede alguém "resolver" uma
 *    conversa por fora do motor, ou apagar uma em vez de arquivar.
 *
 * O que este teste NÃO cobre (e por isso está dito, não subentendido):
 * o efeito da RPC no Postgres, e o trigger `trg_*` que carimba
 * `service_closed_at`. Isso vive em `tests/e2e/` e exige Docker.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: vi.fn(() => false),
}));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: vi.fn(async () => null),
  resolveActiveOrg: vi.fn(async () => null),
}));
vi.mock("@/lib/users/com-nome-do-atendente", () => ({
  comNomeDoAtendente: vi.fn(async (linhas: unknown[]) => linhas),
}));

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "44444444-4444-4444-8444-444444444444";

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface StubState {
  /** Chamadas na RPC do cliente ADMIN: é por lá que o estado de serviço passa. */
  rpcCalls: RpcCall[];
  /** Erro devolvido pela RPC (ex.: { code: "40001" } do lock otimista). */
  erroRpc: { code: string; message: string } | null;
  visible?: boolean;
  updates: unknown[];
}

const CONV_ROW = {
  id: CONV_ID,
  organization_id: ORG_ID,
  status: "closed",
  assigned_to_user_id: AGENT_ID,
  service_revision: 7,
  service_closed_at: "2026-09-10T12:00:00.000Z",
};

/** Cadeia que aceita qualquer ordem de select/update/eq e devolve a conversa. */
function makeSupabaseStub(state: StubState) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    update: (values: unknown) => {
      state.updates.push(values);
      return chain;
    },
    insert: () => chain,
    eq: () => chain,
    neq: () => chain,
    is: () => chain,
    in: () => chain,
    not: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () =>
      Promise.resolve({ data: state.visible === false ? null : CONV_ROW, error: null }),
    single: () => Promise.resolve({ data: CONV_ROW, error: null }),
  });
  return {
    from: () => chain,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      return { data: null, error: null };
    },
  };
}

/** Cliente service-role: é o único caminho por onde o status de serviço passa. */
function makeAdminStub(state: StubState) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args });
      return { data: CONV_ROW, error: state.erroRpc };
    },
  };
}

function agentSession(state: StubState) {
  const user: AuthUser = {
    id: AGENT_ID,
    email: "agent@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "agent" }],
  };
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG_ID, name: "Org", role: "agent" },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createClient).mockResolvedValue(makeSupabaseStub(state) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createAdminClient).mockReturnValue(makeAdminStub(state) as any);
}

function stubState(overrides: Partial<StubState> = {}): StubState {
  return { rpcCalls: [], erroRpc: null, updates: [], ...overrides };
}

function patchReq(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/v1/conversations/${CONV_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: CONV_ID }) };

function rpcDoStatus(state: StubState): RpcCall | undefined {
  return state.rpcCalls.find((c) => c.fn === "fn_service_status");
}

function acoesAuditadas(): string[] {
  return vi.mocked(audit).mock.calls.map(([e]) => (e as { action: string }).action);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isServiceRoleConfigured).mockReturnValue(false);
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(audit).mockResolvedValue(undefined);
});

describe("PATCH /conversations/[id] — arquivar (#923)", () => {
  it('arquiva: RPC fn_service_status com p_status="archived" e evento próprio', async () => {
    const state = stubState();
    agentSession(state);
    const { PATCH } = await import("@/app/api/v1/conversations/[id]/route");

    const res = await PATCH(patchReq({ status: "archived", expected_revision: 7 }), params);

    expect(res.status).toBe(200);
    expect(rpcDoStatus(state)?.args).toMatchObject({
      p_org: ORG_ID,
      p_conversation: CONV_ID,
      p_status: "archived",
      p_expected: 7,
    });
    expect(acoesAuditadas()).toContain("conversation.archived");
    // Arquivar não é fechar: o evento de fechamento não pode aparecer aqui,
    // senão a auditoria conta duas histórias para o mesmo clique.
    expect(acoesAuditadas()).not.toContain("conversation.closed");
    const evento = vi
      .mocked(audit)
      .mock.calls.find(([e]) => (e as { action: string }).action === "conversation.archived");
    expect(evento?.[0]).toMatchObject({
      resourceType: "conversation",
      resourceId: CONV_ID,
      organizationId: ORG_ID,
      metadata: { status: "archived" },
    });
  });

  it("sem expected_revision usa a revisão lida da conversa (não zero)", async () => {
    const state = stubState();
    agentSession(state);
    const { PATCH } = await import("@/app/api/v1/conversations/[id]/route");

    const res = await PATCH(patchReq({ status: "archived" }), params);

    expect(res.status).toBe(200);
    expect(rpcDoStatus(state)?.args).toMatchObject({ p_expected: CONV_ROW.service_revision });
  });

  it("fechar continua auditando conversation.closed (regressão do ternário)", async () => {
    const state = stubState();
    agentSession(state);
    const { PATCH } = await import("@/app/api/v1/conversations/[id]/route");

    const res = await PATCH(patchReq({ status: "closed" }), params);

    expect(res.status).toBe(200);
    expect(rpcDoStatus(state)?.args).toMatchObject({ p_status: "closed" });
    expect(acoesAuditadas()).toContain("conversation.closed");
    expect(acoesAuditadas()).not.toContain("conversation.archived");
  });

  it.each(["40001", "PT409"])(
    "conflito de revisão (%s) → 409 e nenhuma auditoria",
    async (code) => {
      const state = stubState({
        erroRpc: { code, message: "service_stale" },
      });
      agentSession(state);
      const { PATCH } = await import("@/app/api/v1/conversations/[id]/route");

      const res = await PATCH(patchReq({ status: "archived", expected_revision: 3 }), params);

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("conflict");
      expect(vi.mocked(audit)).not.toHaveBeenCalled();
      expect(state.rpcCalls).toHaveLength(1);
      expect(state.updates).toHaveLength(0);
    },
  );

  it("sem escrita de suporte → 403, sem RPC e sem auditoria", async () => {
    const state = stubState();
    agentSession(state);
    vi.mocked(requireSupportWrite).mockResolvedValue(new Response(null, { status: 403 }) as never);
    const { PATCH } = await import("@/app/api/v1/conversations/[id]/route");

    const res = await PATCH(patchReq({ status: "archived" }), params);

    expect(res.status).toBe(403);
    expect(state.rpcCalls).toHaveLength(0);
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it("conversa removida entre leitura e RPC permanece 404 sem auditar", async () => {
    const state = stubState({ erroRpc: { code: "P0002", message: "service_not_found" } });
    agentSession(state);
    const { PATCH } = await import("@/app/api/v1/conversations/[id]/route");
    const res = await PATCH(patchReq({ status: "archived" }), params);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it("status fora do vocabulário gravável → 422 (não existe 'excluida')", async () => {
    const state = stubState();
    agentSession(state);
    const { PATCH } = await import("@/app/api/v1/conversations/[id]/route");

    const res = await PATCH(patchReq({ status: "excluida" }), params);

    expect(res.status).toBe(422);
    expect(state.rpcCalls).toHaveLength(0);
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });
});

describe("POST /conversations/[id]/close — conflito sem repetição", () => {
  function closeReq(body: Record<string, unknown> = {}) {
    return new NextRequest(`http://localhost/api/v1/conversations/${CONV_ID}/close`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it.each(["40001", "PT409"])("conflito %s retorna 409 sem auditar", async (code) => {
    const state = stubState({ erroRpc: { code, message: "service_stale" } });
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/close/route");
    const res = await POST(closeReq({ expected_revision: 3 }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
    expect(state.rpcCalls).toEqual([
      {
        fn: "fn_service_status",
        args: {
          p_org: ORG_ID,
          p_conversation: CONV_ID,
          p_status: "closed",
          p_expected: 3,
        },
      },
    ]);
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(0);
  });

  it("fechamento bem-sucedido mantém auditoria da organização autenticada", async () => {
    const state = stubState();
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/close/route");
    const res = await POST(closeReq(), params);
    expect(res.status).toBe(200);
    expect(rpcDoStatus(state)?.args.p_expected).toBe(7);
    expect(vi.mocked(audit)).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: "conversation.closed",
        organizationId: ORG_ID,
        resourceId: CONV_ID,
      }),
    );
  });

  it("conversa não visível permanece 404 sem chamar RPC administrativa", async () => {
    const state = stubState({ visible: false });
    agentSession(state);
    const { POST } = await import("@/app/api/v1/conversations/[id]/close/route");
    expect((await POST(closeReq(), params)).status).toBe(404);
    expect(state.rpcCalls).toHaveLength(0);
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });

  it("papel sem permissão de escrita permanece 403 sem chamar RPC administrativa", async () => {
    const state = stubState();
    agentSession(state);
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    } as never);
    const { POST } = await import("@/app/api/v1/conversations/[id]/close/route");
    expect((await POST(closeReq(), params)).status).toBe(403);
    expect(vi.mocked(requireRole)).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({ resource: "conversations" }),
    );
    expect(state.rpcCalls).toHaveLength(0);
    expect(vi.mocked(audit)).not.toHaveBeenCalled();
  });
});
