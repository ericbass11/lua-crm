/**
 * Canal só da IA, caminho LEGADO: `triggerHandoff` (worker de sentimento, tool
 * MCP, worker antigo) recusa a passagem antes de avisar o cliente — dizer "uma
 * pessoa vai assumir" num número sem pessoas é mentira, e a passagem calaria a
 * IA para sempre. Irmão de `canal-so-da-ia-nunca-passa-para-humano.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const CONV = "44444444-4444-4444-8444-444444444444";
const ORG = "22222222-2222-4222-8222-222222222222";
const CONTACT = "66666666-6666-4666-8666-666666666666";

const avisarLeadDoCrm = vi.fn(async (..._a: unknown[]) => ({ avisado: true }));
const decidir = vi.fn();
let metadataDoCanal: Record<string, unknown> | null = null;

vi.mock("@/lib/ai/handoff/aviso-ao-lead", () => ({ avisarLeadDoCrm: (...a: unknown[]) => avisarLeadDoCrm(...a) }));
vi.mock("@/lib/ai/elegibilidade/consulta-supabase", () => ({
  decidirElegibilidadeDaConversaViaSupabase: (...a: unknown[]) => decidir(...a),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const updates: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      update: (p: Record<string, unknown>) => {
        updates.push(p);
        return chain;
      },
      insert: () => chain,
      eq: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: {
            id: CONV,
            organization_id: ORG,
            contact_id: CONTACT,
            last_handoff_at: null,
            last_handoff_reason: null,
            channel_sessions: { metadata: metadataDoCanal },
          },
          error: null,
        }),
      then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r),
    };
    return {
      from: () => chain,
      rpc: () => Promise.resolve({ error: null }),
      channel: () => ({ send: () => Promise.resolve(), subscribe: () => ({}) }),
    };
  },
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), isServiceRoleConfigured: () => false }));

import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  decidir.mockResolvedValue({ permite: true, motivo: "numero_de_teste", bloqueioPorAllowlist: false });
});

describe("triggerHandoff · canal só da IA", () => {
  it("recusa: não avisa o cliente e não mexe na conversa", async () => {
    metadataDoCanal = { ai_gate: "allowlist", ai_sem_humano: true };
    const r = await triggerHandoff({ conversationId: CONV, organizationId: ORG, reason: "low_sentiment", origem: "sentimento" });
    expect(r.triggered).toBe(false);
    expect(r.reason).toBe("canal_sem_humano");
    expect(avisarLeadDoCrm).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("controle: canal sem a chave passa como sempre", async () => {
    metadataDoCanal = { ai_gate: "allowlist" };
    const r = await triggerHandoff({ conversationId: CONV, organizationId: ORG, reason: "low_sentiment", origem: "sentimento" });
    expect(avisarLeadDoCrm).toHaveBeenCalledOnce();
    expect(r.triggered).toBe(true);
  });
});
