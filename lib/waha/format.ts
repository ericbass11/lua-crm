/**
 * Normalização de texto gerado por LLM → formatação nativa do WhatsApp.
 *
 * LLMs emitem Markdown (`**negrito**`, `__itálico__`, `# título`), mas o
 * WhatsApp usa sintaxe própria (`*negrito*`, `_itálico_`, sem títulos). Sem
 * esta conversão o cliente vê asteriscos literais sobrando na mensagem
 * (ex.: `**site**` renderiza como `*site*` com asterisco extra visível).
 *
 * Escopo deliberadamente conservador: só converte os padrões inequívocos de
 * Markdown; texto já no formato WhatsApp (`*x*`, `_x_`, `~x~`) passa intacto.
 */

/** Converte Markdown comum de LLM para a sintaxe do WhatsApp. */
export function toWhatsAppText(text: string): string {
  let out = text;
  // ***negrito-itálico*** → *_texto_*
  out = out.replace(/\*\*\*(?!\s)([^*]+?)(?<!\s)\*\*\*/g, "*_$1_*");
  // **negrito** → *negrito*
  out = out.replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, "*$1*");
  // __itálico__ → _itálico_
  out = out.replace(/__(?!\s)([^_]+?)(?<!\s)__/g, "_$1_");
  // ~~tachado~~ → ~tachado~
  out = out.replace(/~~(?!\s)([^~]+?)(?<!\s)~~/g, "~$1~");
  // Títulos markdown (#, ##, ...) no início de linha → linha em negrito
  out = out.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
  return out;
}
