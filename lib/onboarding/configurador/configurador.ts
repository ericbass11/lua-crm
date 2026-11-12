import {
  NICHO_CLIMATIZACAO,
  type AgentSpecV1,
  type PerguntaConfigurador,
  type PerguntaId,
  type SessaoConfigurador,
} from "./tipos";
import { avaliarProntidao } from "./prontidao";

export const PERGUNTAS_CONFIGURADOR: readonly PerguntaConfigurador[] = [
  { id: "nome_do_negocio", texto: "Como sua empresa se chama?" },
  {
    id: "descricao_do_negocio",
    texto: "Em uma frase, o que sua empresa faz e para quem?",
  },
  { id: "regiao_atendida", texto: "Quais cidades ou regiões sua empresa atende?" },
  { id: "horario_de_atendimento", texto: "Em quais dias e horários vocês atendem?" },
  {
    id: "servicos",
    texto: "Quais serviços vocês realizam? Separe cada serviço com ponto e vírgula.",
  },
  {
    id: "qualificacao",
    texto:
      "Quais informações o atendente deve coletar antes do orçamento? Separe com ponto e vírgula.",
  },
  {
    id: "passagem_para_humano",
    texto: "Em quais situações a conversa deve passar para uma pessoa?",
  },
  {
    id: "resumo_para_humano",
    texto: "Quais informações a pessoa do time precisa receber ao assumir a conversa?",
  },
  {
    id: "temas_proibidos",
    texto: "O que o atendente nunca deve afirmar, orientar ou prometer?",
  },
  { id: "tom_de_voz", texto: "Como o atendente deve falar com seus clientes?" },
  {
    id: "perguntas_frequentes",
    texto:
      "Quais perguntas frequentes já têm resposta aprovada? Use uma linha por item no formato Pergunta => Resposta. Se não houver, responda “Não há”.",
  },
] as const;

function specVazia(): AgentSpecV1 {
  return {
    schema_version: 1,
    niche: NICHO_CLIMATIZACAO,
    business: {},
    services: [],
    qualification: [],
    handoff: { triggers: [], summary_fields: [] },
    forbidden_topics: [],
    faq: [],
  };
}

export function iniciarConfigurador(): SessaoConfigurador {
  return {
    status: "coletando",
    pergunta_atual: PERGUNTAS_CONFIGURADOR[0]!,
    respostas: {},
    spec: specVazia(),
  };
}

function respostaValida(resposta: string): string {
  const limpa = resposta
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((linha) => linha.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (!limpa) throw new Error("A resposta não pode ficar vazia.");
  if (limpa.length > 3000) throw new Error("A resposta deve ter no máximo 3.000 caracteres.");
  return limpa;
}

function listaDaResposta(resposta?: string): string[] {
  if (!resposta) return [];
  return resposta
    .split(/;|\n/)
    .map((item) => item.replace(/^[-•]\s*/, "").trim())
    .filter(Boolean);
}

function faqDaResposta(resposta?: string): AgentSpecV1["faq"] {
  if (!resposta || /^n[aã]o (?:h[aá]|tenho)$/i.test(resposta.trim())) return [];
  return resposta
    .split(/\n/)
    .map((linha) => linha.split(/\s*=>\s*/, 2).map((parte) => parte.trim()))
    .filter((partes): partes is [string, string] => partes.length === 2 && partes.every(Boolean))
    .map(([question, answer]) => ({ question, answer }));
}

function montarSpec(respostas: SessaoConfigurador["respostas"]): AgentSpecV1 {
  return {
    schema_version: 1,
    niche: NICHO_CLIMATIZACAO,
    business: {
      ...(respostas.nome_do_negocio ? { name: respostas.nome_do_negocio } : {}),
      ...(respostas.descricao_do_negocio ? { description: respostas.descricao_do_negocio } : {}),
      ...(respostas.regiao_atendida ? { service_area: respostas.regiao_atendida } : {}),
      ...(respostas.horario_de_atendimento
        ? { opening_hours: respostas.horario_de_atendimento }
        : {}),
    },
    services: listaDaResposta(respostas.servicos),
    qualification: listaDaResposta(respostas.qualificacao),
    handoff: {
      triggers: listaDaResposta(respostas.passagem_para_humano),
      summary_fields: listaDaResposta(respostas.resumo_para_humano),
    },
    forbidden_topics: listaDaResposta(respostas.temas_proibidos),
    ...(respostas.tom_de_voz ? { tone: respostas.tom_de_voz } : {}),
    faq: faqDaResposta(respostas.perguntas_frequentes),
  };
}

function proximaPergunta(respostas: SessaoConfigurador["respostas"]): PerguntaConfigurador | null {
  return PERGUNTAS_CONFIGURADOR.find((pergunta) => respostas[pergunta.id] === undefined) ?? null;
}

function reconstruirSessao(respostas: SessaoConfigurador["respostas"]): SessaoConfigurador {
  const perguntaAtual = proximaPergunta(respostas);
  return {
    status: perguntaAtual ? "coletando" : "pronto_para_revisao",
    pergunta_atual: perguntaAtual,
    respostas,
    spec: montarSpec(respostas),
  };
}

/**
 * Registra somente o texto que o dono acabou de responder. O núcleo não chama
 * modelo e não completa lacunas: interpretação mais rica pode existir acima
 * deste seam, mas precisa voltar como revisão explícita de um campo.
 */
export function responderPergunta(
  sessao: SessaoConfigurador,
  resposta: string,
): SessaoConfigurador {
  if (!sessao.pergunta_atual) throw new Error("A entrevista terminou; revise o resumo.");
  return reconstruirSessao({
    ...sessao.respostas,
    [sessao.pergunta_atual.id]: respostaValida(resposta),
  });
}

export function revisarResposta(
  sessao: SessaoConfigurador,
  perguntaId: PerguntaId,
  resposta: string,
): SessaoConfigurador {
  if (sessao.respostas[perguntaId] === undefined)
    throw new Error("Só é possível revisar uma pergunta que já foi respondida.");
  return reconstruirSessao({
    ...sessao.respostas,
    [perguntaId]: respostaValida(resposta),
  });
}

export function confirmarRevisao(sessao: SessaoConfigurador): SessaoConfigurador {
  const prontidao = avaliarProntidao(sessao.spec);
  if (!prontidao.ready)
    throw new Error("A configuração está incompleta e ainda não pode ser confirmada.");
  return { ...sessao, status: "revisado", pergunta_atual: null };
}
