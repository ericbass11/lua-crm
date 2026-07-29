/**
 * Leitura dos campos do formulário de Proteção de envio (`AntiBanSheet`).
 *
 * POR QUE VIVE FORA DO COMPONENTE: o caminho "texto do input → número que a API
 * aceita" tem três armadilhas que já produziram um 422 sem explicação na tela, e
 * armadilha sem teste volta:
 *
 *  1. **Teto de intervalo.** O schema aceita no máximo `KNOB_BOUNDS.intervalMaxMs`
 *     (600.000 ms = 600 s). O campo é em SEGUNDOS, então 2497 digitado vira
 *     2.497.000 ms e o Zod recusa. O limite tem que ser dito ANTES do envio, na
 *     unidade do campo — o operador não sabe (nem deveria) que o motor pensa em ms.
 *  2. **Vírgula decimal.** `Number("1,2")` é `NaN` em JS, e `Math.round(NaN)` é
 *     `NaN`, que o `JSON.stringify` transforma em `null` — e `null` significa
 *     "voltar ao padrão do motor". Quem digitasse `1,2` (o jeito pt-BR) veria o
 *     campo reverter ao default em silêncio, sem erro nenhum. Silêncio é pior que
 *     recusa: o operador acha que salvou um ritmo que não existe.
 *  3. **Texto não-numérico.** Mesma rota do item 2 — `NaN` → `null` → default
 *     silencioso. Aqui isso é ERRO explícito.
 *
 * Contrato: string vazia = "usar o padrão do motor" (`null`), que é intencional e
 * documentado na tela. Qualquer outra coisa é número válido ou erro nomeado.
 */

/** Sucesso com o valor lido, ou falha com a mensagem pronta para o operador. */
export type LeituraCampo<T> = { ok: true; valor: T } | { ok: false; erro: string };

/**
 * Número decimal tolerante ao pt-BR. `null` = campo vazio (usar padrão);
 * `undefined` = não é número.
 */
export function parseDecimalPtBr(raw: string): number | null | undefined {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Campo em SEGUNDOS → milissegundos, validando contra o teto do schema.
 * `tetoMs` vem de `bounds.intervalMaxMs` (nunca literal — regra do módulo de pacing).
 */
export function lerSegundosEmMs(
  raw: string,
  campo: string,
  tetoMs: number,
): LeituraCampo<number | null> {
  const n = parseDecimalPtBr(raw);
  if (n === undefined) return { ok: false, erro: `${campo}: use um número em segundos.` };
  if (n === null) return { ok: true, valor: null };
  if (n < 0) return { ok: false, erro: `${campo}: não pode ser negativo.` };
  const ms = Math.round(n * 1000);
  if (ms > tetoMs) {
    return { ok: false, erro: `${campo}: no máximo ${tetoMs / 1000}s.` };
  }
  return { ok: true, valor: ms };
}

/** Campo inteiro (hora, teto diário) com faixa própria. */
export function lerInteiro(
  raw: string,
  campo: string,
  min: number,
  max: number,
): LeituraCampo<number | null> {
  const n = parseDecimalPtBr(raw);
  if (n === undefined) return { ok: false, erro: `${campo}: use um número.` };
  if (n === null) return { ok: true, valor: null };
  const i = Math.round(n);
  if (i < min || i > max) return { ok: false, erro: `${campo}: use um valor entre ${min} e ${max}.` };
  return { ok: true, valor: i };
}

/**
 * Campo "Número ativo desde" (`<input type="date">` → `YYYY-MM-DD`).
 *
 * Vazio = não mexer na data já registrada (a coluna é `not null`; quem decide o
 * valor inicial é a rota, a partir do `created_at` da conexão). Data no futuro é
 * recusada aqui porque o motor a clamparia para idade 0 em silêncio — o operador
 * veria o número virar "recém-nascido" sem entender por quê.
 *
 * `hoje` é injetado para o teste não depender do relógio da máquina.
 */
export function lerDataAtivacao(raw: string, hoje: Date): LeituraCampo<string | null> {
  const t = raw.trim();
  if (t === "") return { ok: true, valor: null };
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) {
    return { ok: false, erro: "Número ativo desde: use uma data válida (AAAA-MM-DD)." };
  }
  // Compara por DIA: `type="date"` devolve meia-noite UTC, e um fuso a oeste faria
  // "hoje" parecer futuro por algumas horas.
  const dia = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (dia(new Date(ms)) > dia(hoje)) {
    return { ok: false, erro: "Número ativo desde: a data não pode estar no futuro." };
  }
  return { ok: true, valor: t };
}

/**
 * Erros de campo que a API devolve em `details` (flatten do Zod) viram uma linha
 * legível. Sem isto o `catch` do formulário mostrava só "Campos inválidos." e o
 * operador não tinha como saber qual campo nem qual limite — foi exatamente o
 * sintoma relatado ao salvar a Proteção de envio.
 */
export function descreveErroDeValidacao(details: Record<string, unknown> | undefined): string | null {
  if (!details) return null;
  const fieldErrors = (details as { fieldErrors?: Record<string, string[] | undefined> })
    .fieldErrors;
  if (!fieldErrors) return null;
  const partes = Object.entries(fieldErrors)
    .filter(([, msgs]) => Array.isArray(msgs) && msgs.length > 0)
    .map(([campo, msgs]) => `${campo}: ${msgs![0]}`);
  return partes.length > 0 ? partes.join(" · ") : null;
}
