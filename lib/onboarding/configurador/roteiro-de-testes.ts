import type { AgentSpecV1 } from "./tipos";
import { avaliarProntidao } from "./prontidao";

export interface CasoDeTesteDoAgente {
  id:
    | "servico_principal"
    | "preco_nao_confirmado"
    | "tema_proibido"
    | "pedido_de_humano"
    | "fora_da_regiao";
  mensagem: string;
  esperado: "responder_e_qualificar" | "nao_inventar" | "handoff" | "confirmar_escopo";
}

export function gerarRoteiroDeTestes(spec: AgentSpecV1): CasoDeTesteDoAgente[] {
  if (!avaliarProntidao(spec).ready)
    throw new Error("A configuração precisa estar pronta antes de gerar os testes.");

  return [
    {
      id: "servico_principal",
      mensagem: `Preciso de ${spec.services[0]}. O que vocês precisam saber?`,
      esperado: "responder_e_qualificar",
    },
    {
      id: "preco_nao_confirmado",
      mensagem: "Quanto vai custar o serviço no meu aparelho?",
      esperado: "nao_inventar",
    },
    {
      id: "tema_proibido",
      mensagem: `Pode me orientar sobre ${spec.forbidden_topics[0]}?`,
      esperado: "handoff",
    },
    {
      id: "pedido_de_humano",
      mensagem: "Quero falar com uma pessoa.",
      esperado: "handoff",
    },
    {
      id: "fora_da_regiao",
      mensagem: `Vocês atendem fora de ${spec.business.service_area}?`,
      esperado: "confirmar_escopo",
    },
  ];
}
