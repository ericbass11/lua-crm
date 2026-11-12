export const PLANO_MANAGED_MVP = {
  id: "managed_mvp_inbound",
  nome: "Plano único beta",
  descricao:
    "Atendente de IA para responder clientes no WhatsApp, qualificar pedidos e organizar orçamentos.",
  preco_mensal_centavos: 19_700,
  respostas_ia_incluidas: 2_000,
  numeros_whatsapp: 1,
  agentes: 1,
  permite_disparos: false,
  suporte: "assíncrono",
} as const;

export const PLANOS_COMERCIAIS = [PLANO_MANAGED_MVP] as const;
