import { describe, expect, it, vi } from "vitest";

import { buildOpeningMessage, loadInboundBodyForJob } from "@/lib/agent-engine/agent/inbound-turn";
import {
  __test_fitToBudget,
  corpoDaMensagem,
  type LeadContext,
} from "@/lib/agent-engine/edge/crm/get-lead-context";
import type { Queryable } from "@/lib/agent-engine/queue/queue";

/**
 * A FOTO QUE CHEGA SEM ARQUIVO.
 *
 * O WAHA às vezes entrega `hasMedia` sem `media.url` (download falhou do lado
 * dele). A ingestão grava a linha com `type='image'`, `media_url` e
 * `media_storage_path` NULOS e sem legenda — medido na VPS em 27/10 e 30/10/2026,
 * duas fotos assim. Sem URL o `media.persist_requested` nem é emitido, então a
 * linha nunca ganha derivado.
 *
 * `corpoDaMensagem` só reconhecia mídia pela URL/arquivo: a foto valia `''`, a
 * abertura dizia "Não há texto utilizável" e o modelo não sabia que o cliente
 * tinha mandado uma imagem. A correção não inventa conteúdo — diz que veio uma
 * imagem e que ela não pôde ser lida.
 */

const LINHA_DA_FOTO_SEM_ARQUIVO = {
  type: "image",
  body: null,
  media_url: null,
  media_storage_path: null,
  media_derived_text: null,
};

describe("foto sem arquivo não some do contexto do turno", () => {
  it("o corpo diz que veio uma imagem que não pôde ser lida, em vez de ''", () => {
    const corpo = corpoDaMensagem(LINHA_DA_FOTO_SEM_ARQUIVO);
    expect(corpo).not.toBe("");
    expect(corpo).toContain("uma imagem");
    expect(corpo).toContain("não");
  });

  it("a legenda continua sendo o corpo quando existe", () => {
    expect(corpoDaMensagem({ ...LINHA_DA_FOTO_SEM_ARQUIVO, body: "olha isso" })).toContain("olha isso");
  });

  it("texto sem mídia e sem corpo continua vazio — o vazio ali é a verdade", () => {
    expect(corpoDaMensagem({ ...LINHA_DA_FOTO_SEM_ARQUIVO, type: "text" })).toBe("");
  });

  it("a linha canônica do job e a abertura não anunciam mensagem vazia", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [LINHA_DA_FOTO_SEM_ARQUIVO] });
    const texto =
      (await loadInboundBodyForJob({ query } as unknown as Queryable, {
        tenantId: "11111111-1111-4111-8111-111111111111",
        conversationId: "22222222-2222-4222-8222-222222222222",
        inboundMessageId: "33333333-3333-4333-8333-333333333333",
      })) ?? "";
    const contexto: LeadContext = {
      lead_id: "11111111-1111-4111-8111-111111111111",
      contact: { name: "Cliente", phone: null, email: null, tags: [], is_blocked: false },
      conversation_id: "22222222-2222-4222-8222-222222222222",
      last_human_decision: null,
      messages: [{ direction: "inbound", body: texto, sent_at: "2026-10-30T12:28:57-03:00" }],
    };
    const abertura = buildOpeningMessage(null, null, contexto, "sem notas", false, [], "", texto);
    expect(abertura).not.toContain("Não há texto utilizável");
    expect(abertura).toContain("uma imagem");
  });

  it("o histórico compõe a mesma linha do mesmo jeito", () => {
    const ctx = __test_fitToBudget(
      { lead_id: "x", contact: { name: "C", phone: null, email: null, tags: [], is_blocked: false }, conversation_id: "c", last_human_decision: null } as never,
      [{ direction: "inbound", ...LINHA_DA_FOTO_SEM_ARQUIVO, media_mime: "image/jpeg", sent_at: new Date("2026-10-30T15:28:57Z") }],
      100_000,
      "America/Sao_Paulo",
    );
    expect(ctx.messages[0]!.body).toBe(corpoDaMensagem(LINHA_DA_FOTO_SEM_ARQUIVO));
  });
});
