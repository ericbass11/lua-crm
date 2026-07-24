/**
 * lib/phone.ts — normalização de número de telefone para E.164.
 *
 * Usado pelo envio ativo (POST /api/v1/conversations), que recebe um número
 * digitado à mão pelo operador e precisa convertê-lo na identidade canônica
 * `+<E164>` antes de resolver o contato/conversa via as RPCs de ingestão WAHA
 * (que esperam `phone` E.164 e `chat_id` no formato `<digits>@c.us`).
 *
 * Escopo deliberadamente pequeno (Brasil-first, sem libphonenumber): o produto
 * opera para números brasileiros. Aceita entradas com máscara ("(11) 99999-9999"),
 * com DDI ("+55 11 ..."), ou já em E.164 e devolve sempre "+55DDNXXXXXXXX".
 */

const DEFAULT_COUNTRY_CODE = "55"; // Brasil

export interface E164Result {
  /** Número normalizado no formato "+55...". */
  e164: string;
  /** chatId WAHA correspondente ("<digits>@c.us"). */
  chatId: string;
}

/**
 * Normaliza um número digitado para E.164 (default DDI +55).
 *
 * Regras:
 *  - Remove tudo que não for dígito (e um "+" líder é tratado como "já tem DDI").
 *  - Se começa com "+", assume que os dígitos já incluem o DDI.
 *  - Sem "+": se já começa com "55" e tem comprimento de número BR com DDI
 *    (12-13 dígitos), assume que o DDI já está presente; senão prefixa "55".
 *
 * Retorna `null` quando não há dígitos suficientes para um número discável
 * (menos de 10 dígitos após normalização — DDD + assinante).
 */
export function normalizeToE164(raw: string): E164Result | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (!hasPlus) {
    // Sem DDI explícito: só assume que o "55" já é DDI quando o comprimento
    // bate com um número BR completo (DDI 55 + DDD 2 + assinante 8/9 = 12/13).
    const looksLikeBrWithCc =
      digits.startsWith(DEFAULT_COUNTRY_CODE) && (digits.length === 12 || digits.length === 13);
    if (!looksLikeBrWithCc) {
      digits = DEFAULT_COUNTRY_CODE + digits;
    }
  }

  // Guarda mínima: DDI(1-3) + DDD(2) + assinante(8) ⇒ ao menos 10 dígitos.
  if (digits.length < 10) return null;

  return { e164: `+${digits}`, chatId: `${digits}@c.us` };
}
