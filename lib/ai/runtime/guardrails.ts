/**
 * lib/ai/runtime/guardrails.ts — motor de enforcement dos guardrails de SAÍDA
 * do agente, avaliado ENTRE o generateText() e o envio ao cliente (agent.ts §16).
 *
 * Até então o schema de guardrails (lib/ai/guardrails-schema.ts) era letra morta:
 * ficava salvo em `ai_agents.guardrails` mas nada o lia em runtime. Este módulo
 * ativa dois guardrails configuráveis (`regex_output_block`, `rag_must_hit`) e
 * adiciona um **gate de preço sempre ligado**: um agente de vendas NÃO pode
 * inventar valor. Se o texto final cita um preço que NÃO aparece em nenhuma
 * fonte verificada (system prompt do tenant, trechos do RAG, ou resultado de
 * tool), a resposta é bloqueada antes de chegar ao cliente — o runtime então
 * escala em silêncio para um humano.
 *
 * Módulo puro (sem I/O) → 100% testável. Viés deliberado para o lado seguro:
 * na dúvida de formatação, preferimos bloquear (falso-negativo = handoff
 * desnecessário, chato) a deixar passar (falso-positivo = preço inventado no
 * cliente, catastrófico).
 */
import type { Guardrails } from "@/lib/ai/guardrails-schema";

export interface GuardrailVerdict {
  blocked: boolean;
  /** Identificador do que disparou (ex.: "price_unground", "regex_output_block"). */
  kind: string | null;
  /** Razão legível (do guardrail configurado, ou do gate de preço). */
  reason: string | null;
  detail?: Record<string, unknown>;
}

const PASS: GuardrailVerdict = { blocked: false, kind: null, reason: null };

// ---------------------------------------------------------------------------
// Extração de valores monetários (pt-BR)
// ---------------------------------------------------------------------------

// Núcleo numérico: "1.234,56" | "1234,56" | "1.234" | "1234" | "99"
const NUM_CORE = "\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?";
// Preço = "R$ <num>" OU "<num> reais/real". Só contexto monetário explícito —
// não captura "15h", "10 minutos", "2 opções" (evita falso-positivo).
const MONEY_RX = new RegExp(
  `(?:R\\$\\s?(${NUM_CORE}))|(?:\\b(${NUM_CORE})\\s?(?:reais|real)\\b)`,
  "gi",
);

/**
 * Normaliza um núcleo numérico pt-BR para uma chave canônica comparável:
 * remove separador de milhar "." e troca a vírgula decimal por ".". Sem
 * casas decimais quando forem ",00" (para "1.200" casar com "1200,00").
 *   "1.234,56" → "1234.56" ; "1.200" → "1200" ; "99,90" → "99.9" ; "50" → "50"
 */
export function normalizeNumeric(raw: string): string {
  const noThousands = raw.replace(/\./g, "");
  const dotted = noThousands.replace(",", ".");
  const n = Number(dotted);
  if (Number.isNaN(n)) return dotted;
  // Remove zeros decimais irrelevantes de forma estável (99.90 → 99.9, 50.00 → 50).
  return String(n);
}

/**
 * Extrai os valores monetários citados num texto, já normalizados (dedup).
 */
export function extractMonetaryValues(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(MONEY_RX)) {
    const core = m[1] ?? m[2];
    if (core) out.add(normalizeNumeric(core));
  }
  return [...out];
}

/**
 * Conjunto de números presentes num corpus (para checar fundamentação).
 * Varre QUALQUER número (com/sem R$) — o corpus é fonte confiável, então um
 * "1234" solto no prompt fundamenta "R$ 1.234".
 */
function corpusNumberSet(corpus: string): Set<string> {
  const set = new Set<string>();
  for (const m of corpus.matchAll(new RegExp(NUM_CORE, "g"))) {
    set.add(normalizeNumeric(m[0]));
  }
  return set;
}

// ---------------------------------------------------------------------------
// Gate de preço (sempre ligado)
// ---------------------------------------------------------------------------

export interface PriceGateInput {
  /** Texto final que iria ao cliente. */
  text: string;
  /** Fontes verificadas concatenadas: system_prompt + RAG + resultados de tools. */
  groundingCorpus: string;
}

/**
 * Retorna os preços citados no texto que NÃO aparecem no corpus verificado.
 */
export function ungroundedPrices(input: PriceGateInput): string[] {
  const cited = extractMonetaryValues(input.text);
  if (cited.length === 0) return [];
  const grounded = corpusNumberSet(input.groundingCorpus);
  return cited.filter((v) => !grounded.has(v));
}

// ---------------------------------------------------------------------------
// Avaliação combinada (chamada pelo runtime)
// ---------------------------------------------------------------------------

export interface EvaluateOutputInput {
  text: string;
  groundingCorpus: string;
  guardrails: Guardrails;
  /** Quantas fontes RAG foram recuperadas (para rag_must_hit). */
  citationCount: number;
  /** Permite desligar o gate de preço em testes; produção é sempre true. */
  priceGateEnabled?: boolean;
}

/**
 * Avalia todos os guardrails de saída na ordem: (1) gate de preço sempre ligado,
 * (2) regex_output_block configurados, (3) rag_must_hit. Retorna no PRIMEIRO
 * bloqueio (fail-fast) — o runtime escala e nenhuma resposta é enviada.
 */
export function evaluateOutputGuardrails(input: EvaluateOutputInput): GuardrailVerdict {
  const text = input.text ?? "";

  // 1) Gate de preço — sempre ligado (o princípio nº1: nunca inventar preço).
  if (input.priceGateEnabled !== false) {
    const bad = ungroundedPrices({ text, groundingCorpus: input.groundingCorpus });
    if (bad.length > 0) {
      return {
        blocked: true,
        kind: "price_unground",
        reason: "Preço citado sem fonte verificada (catálogo/base). Escalado para humano.",
        detail: { blocked_values: bad },
      };
    }
  }

  // 2/3) Guardrails configurados por agente.
  for (const g of input.guardrails ?? []) {
    if (g.kind === "regex_output_block") {
      let rx: RegExp | null = null;
      try {
        rx = new RegExp(g.pattern, g.flags ?? "i");
      } catch {
        rx = null; // padrão inválido → ignora (não derruba o envio por config ruim)
      }
      if (rx && rx.test(text)) {
        return {
          blocked: true,
          kind: "regex_output_block",
          reason: g.reason,
          detail: { pattern: g.pattern },
        };
      }
    } else if (g.kind === "rag_must_hit") {
      if (input.citationCount < g.min_citations) {
        return {
          blocked: true,
          kind: "rag_must_hit",
          reason: g.reason,
          detail: { min_citations: g.min_citations, got: input.citationCount },
        };
      }
    }
    // regex_input_block / window_check / contact_flag são gates de ENTRADA/contexto,
    // não de saída — avaliados noutro ponto (fora do escopo deste passo).
  }

  return PASS;
}
