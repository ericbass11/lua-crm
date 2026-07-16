/**
 * Enriquecimento de mídia inbound → texto, para a IA "ouvir" áudio e "ver"
 * imagem que o cliente manda no WhatsApp.
 *
 *  - áudio (ptt/audio): transcrição via OpenAI Whisper.
 *  - imagem: descrição objetiva via modelo de visão (gpt-4o-mini).
 *
 * Só funciona com credencial OpenAI (Whisper/visão). Outros provedores →
 * devolve um aviso curto, para a IA pedir que o cliente escreva. O texto
 * resultante é gravado em `messages.body` pelo chamador (cache + aparece no
 * inbox). A chave de API vive só neste escopo.
 */
const OPENAI_BASE = "https://api.openai.com/v1";

/** Baixa os bytes da mídia (URL do WAHA com X-Api-Key, ou data: URL). */
async function fetchMediaBytes(
  mediaUrl: string,
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  if (mediaUrl.startsWith("data:")) {
    const comma = mediaUrl.indexOf(",");
    const meta = comma >= 0 ? mediaUrl.slice(5, comma) : "";
    const b64 = comma >= 0 ? mediaUrl.slice(comma + 1) : "";
    const mime = meta.split(";")[0] || "application/octet-stream";
    return { bytes: Buffer.from(b64, "base64").buffer as ArrayBuffer, mime };
  }
  const wahaKey = process.env.WAHA_API_KEY;
  const res = await fetch(mediaUrl, {
    headers: wahaKey ? { "X-Api-Key": wahaKey } : {},
  });
  if (!res.ok) return null;
  const mime = res.headers.get("content-type") ?? "application/octet-stream";
  return { bytes: await res.arrayBuffer(), mime };
}

async function transcribeAudio(apiKey: string, bytes: ArrayBuffer, mime: string): Promise<string | null> {
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("mpeg") || mime.includes("mp3") ? "mp3" : "ogg";
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mime }), `audio.${ext}`);
  form.append("model", "whisper-1");
  form.append("language", "pt");
  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { text?: string };
  return json.text?.trim() || null;
}

async function describeImage(apiKey: string, bytes: ArrayBuffer, mime: string): Promise<string | null> {
  const b64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Um cliente enviou esta imagem numa conversa de WhatsApp com uma empresa. Descreva objetivamente, em português, o que a imagem mostra e qualquer texto legível nela. Seja conciso (2-3 frases).",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() || null;
}

/**
 * Converte a mídia inbound em texto utilizável. Retorna null quando não há o
 * que fazer (deixa o body como está).
 */
export async function enrichInboundMedia(params: {
  provider: string;
  apiKey: string;
  type: string;
  mediaUrl: string | null;
  mediaMime: string | null;
}): Promise<string | null> {
  const { provider, apiKey, type, mediaUrl } = params;
  if (type !== "audio" && type !== "image") return null;
  if (!mediaUrl) return null;

  if (provider !== "openai") {
    return type === "audio"
      ? "[O cliente enviou um áudio, mas a transcrição não está disponível neste provedor. Peça gentilmente que ele escreva o que precisa.]"
      : "[O cliente enviou uma imagem que não pôde ser interpretada. Peça gentilmente que ele descreva o que enviou.]";
  }

  try {
    const media = await fetchMediaBytes(mediaUrl);
    if (!media) return null;
    if (type === "audio") {
      const text = await transcribeAudio(apiKey, media.bytes, media.mime);
      return text ? `[Áudio transcrito] ${text}` : null;
    }
    const desc = await describeImage(apiKey, media.bytes, media.mime);
    return desc ? `[Imagem enviada pelo cliente] ${desc}` : null;
  } catch {
    return null;
  }
}
