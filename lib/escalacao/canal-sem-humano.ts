import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CANAL SÓ DA IA — nenhuma conversa dele é passada a uma pessoa.
 *
 * Há números de WhatsApp que existem só para a IA: ninguém da equipe abre
 * aquelas conversas, nem vai abrir. Neles, a passagem para atendimento humano
 * não é uma rede de segurança, é o fim da conversa: `force_human = true` e
 * `bot_silenced_until = 'infinity'` calam a IA para sempre, e a fila onde a
 * passagem cai não tem quem atenda. Medido em produção em 30/10/2026: os dois
 * números de teste de um canal assim foram passados por `low_confidence`
 * (teto de etapas) e a IA ficou muda para eles por dias, com
 * `handoff_tool_enabled = false` na versão publicada — aquela chave só tira a
 * ferramenta do modelo, e os outros caminhos de passagem não a leem.
 *
 * A chave mora em `channel_sessions.metadata.ai_sem_humano` (booleano), ao lado
 * do gate de elegibilidade, porque é uma propriedade do NÚMERO, não do agente:
 * trocar o agente publicado não pode reabrir a fila humana. Só `true` liga —
 * qualquer outro valor (ausente, string, null) é o comportamento de sempre.
 *
 * Leitura com erro de banco → `false` (passa como antes). A falha é rara e o
 * comportamento antigo é o que todo outro canal tem; o chamador loga.
 *
 * ⚠️ LIMITE CONHECIDO — o worker legado. `workers/ai-response-worker.ts` só
 * responde em organização SEM versão de agente publicada (antes disso ele sai
 * com `engine_owns_reply`). Nesse caminho, os gatilhos G1/G3/G4 e o teto de
 * gasto chamam `triggerHandoff`, que recusa a passagem aqui — mas o worker
 * descarta a resposta daquela mensagem do mesmo jeito. O cliente não é calado
 * para sempre (nada é gravado), só aquela mensagem fica sem resposta. Canal só
 * da IA pressupõe o agent-engine, isto é, um agente publicado.
 */
export const CHAVE_CANAL_SEM_HUMANO = "ai_sem_humano" as const;

/** Lê a chave de um `metadata` cru do canal. Só `true` liga. */
export function canalSemHumano(metadata: unknown): boolean {
  return (
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>)[CHAVE_CANAL_SEM_HUMANO] === true
  );
}

interface ConsultaPg {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/** A conversa pertence a um canal só da IA? Via pool `pg` (agent-engine). */
export async function conversaEmCanalSemHumano(
  db: ConsultaPg,
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  const { rows } = await db.query(
    `select cs.metadata as channel_metadata
       from conversations cv
       join channel_sessions cs
         on cs.id = cv.channel_session_id and cs.organization_id = cv.organization_id
      where cv.organization_id = $1 and cv.id = $2`,
    [organizationId, conversationId],
  );
  const linha = rows[0] as { channel_metadata?: unknown } | undefined;
  return canalSemHumano(linha?.channel_metadata);
}

/** Espelho de `conversaEmCanalSemHumano` para quem só tem o `supabase-js`. */
export async function conversaEmCanalSemHumanoViaSupabase(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("conversations")
    .select("channel_sessions:channel_session_id(metadata)")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`canal-sem-humano: leitura falhou — ${error.message}`);
  const canal = (data as { channel_sessions?: { metadata?: unknown } | null } | null)?.channel_sessions;
  return canalSemHumano(canal?.metadata);
}
