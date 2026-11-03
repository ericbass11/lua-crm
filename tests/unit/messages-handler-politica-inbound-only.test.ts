import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import type { HandlerCtx } from "@/lib/api/handlers/types";
import type { SendMessageInput } from "@/lib/schemas";
import { criarDubleDoHandler } from "@/tests/helpers/duble-do-handler";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: vi.fn() }) } }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTACT = "33333333-3333-4333-8333-333333333333";
const SESSION = "44444444-4444-4444-8444-444444444444";
const INBOUND = "55555555-5555-4555-8555-555555555555";

const mensagem = {
  conversation_id: CONV,
  type: "text",
  body: "Como posso ajudar?",
} as SendMessageInput;

function conversa(perfil = "managed_mvp_inbound", isGroup = false) {
  return {
    id: CONV,
    organization_id: ORG,
    contact_id: CONTACT,
    channel_session_id: SESSION,
    is_group: isGroup,
    group_chat_id: isGroup ? "grupo@g.us" : null,
    contacts: { phone_number: "+5531999998888", wa_identity: null, wa_lid: null, is_blocked: false },
    channel_sessions: {
      provider: "waha",
      waha_session_name: "default",
      status: "WORKING",
      archived_at: null,
    },
    organizations: { settings: perfil ? { operation_profile: perfil } : {} },
  };
}

function contexto(over: Partial<HandlerCtx> = {}): HandlerCtx {
  return {
    organization_id: ORG,
    actor: { type: "webhook_source", id: "sistema" },
    requestId: "req-inbound-only",
    ...over,
  };
}

describe("sendMessageHandler — perfil managed_mvp_inbound", () => {
  beforeEach(() => {
    vi.stubEnv("WAHA_API_BASE_URL", "");
    vi.stubEnv("WAHA_API_KEY", "");
  });
  it("barra campanha no sink antes de criar a mensagem", async () => {
    const { supabase, capturas } = criarDubleDoHandler({ conversation: conversa() });

    await expect(
      sendMessageHandler(
        supabase,
        contexto({ outboundIntent: { kind: "campaign" } }),
        mensagem,
      ),
    ).rejects.toMatchObject({ status: 403, code: "managed_mvp_inbound_only" });
    expect(capturas.inserts.messages).toEqual([]);
  });

  it("aceita resposta automática somente quando o inbound pertence à conversa", async () => {
    const { supabase, capturas } = criarDubleDoHandler({
      conversation: conversa(),
      inboundMessage: {
        id: INBOUND,
        organization_id: ORG,
        conversation_id: CONV,
        direction: "inbound",
      },
    });

    const resultado = await sendMessageHandler(
      supabase,
      contexto({
        actor: { type: "ai_agent", id: "agente", role: "manager" },
        outboundIntent: { kind: "inbound_reply", inboundMessageId: INBOUND },
      }),
      mensagem,
    );

    expect(resultado.status).toBe("queued");
    expect(capturas.inserts.messages).toHaveLength(1);
  });

  it("barra referência de inbound que não pertence à conversa", async () => {
    const { supabase, capturas } = criarDubleDoHandler({
      conversation: conversa(),
      inboundMessage: null,
    });

    await expect(
      sendMessageHandler(
        supabase,
        contexto({
          actor: { type: "ai_agent", id: "agente", role: "manager" },
          outboundIntent: { kind: "inbound_reply", inboundMessageId: INBOUND },
        }),
        mensagem,
      ),
    ).rejects.toMatchObject({ status: 403, code: "managed_mvp_inbound_only" });
    expect(capturas.inserts.messages).toEqual([]);
  });

  it("barra grupos inclusive para resposta humana", async () => {
    const { supabase, capturas } = criarDubleDoHandler({ conversation: conversa(undefined, true) });

    await expect(
      sendMessageHandler(
        supabase,
        contexto({ actor: { type: "user", id: "operador", role: "manager" } }),
        mensagem,
      ),
    ).rejects.toMatchObject({ status: 403, code: "managed_mvp_inbound_only" });
    expect(capturas.inserts.messages).toEqual([]);
  });

  it("barra mensagem humana avulsa quando a conversa nunca recebeu inbound", async () => {
    const { supabase, capturas } = criarDubleDoHandler({ conversation: conversa() });

    await expect(
      sendMessageHandler(
        supabase,
        contexto({ actor: { type: "user", id: "operador", role: "manager" } }),
        mensagem,
      ),
    ).rejects.toMatchObject({ status: 403, code: "managed_mvp_inbound_only" });
    expect(capturas.inserts.messages).toEqual([]);
  });

  it("não altera a organização sem o perfil", async () => {
    const { supabase, capturas } = criarDubleDoHandler({ conversation: conversa("") });

    const resultado = await sendMessageHandler(
      supabase,
      contexto({ outboundIntent: { kind: "campaign" } }),
      mensagem,
    );

    expect(resultado.status).toBe("queued");
    expect(capturas.inserts.messages).toHaveLength(1);
  });
});
