import { z } from "zod";

/**
 * Versão do aviso aceito antes de conectar um canal por dispositivo vinculado.
 * Mudar o texto materialmente exige uma versão nova para que o histórico diga
 * qual risco a pessoa viu — não apenas que algum checkbox foi marcado.
 */
export const RISCO_WHATSAPP_VERSAO = "2026-10-01" as const;

export const declaracaoDoRiscoWhatsapp =
  "Esta versão usa uma conexão não oficial com o WhatsApp por dispositivo vinculado e QR Code. " +
  "A sessão pode exigir uma nova leitura do QR Code e sofrer desconexões, interrupções ou " +
  "restrições impostas pelo WhatsApp. Durante o beta, recomendamos um número empresarial dedicado.";

export const aceiteDoRiscoWhatsappSchema = z.object({
  accepted: z.literal(true),
  version: z.literal(RISCO_WHATSAPP_VERSAO),
});

export type AceiteDoRiscoWhatsapp = z.infer<typeof aceiteDoRiscoWhatsappSchema>;
