import { describe, expect, it } from "vitest";

import {
  confirmarRevisao,
  iniciarConfigurador,
  responderPergunta,
  revisarResposta,
} from "./configurador";
import { avaliarProntidao } from "./prontidao";
import { gerarRoteiroDeTestes } from "./roteiro-de-testes";
import { sessaoConfiguradorSchema } from "./tipos";

function responderTudo() {
  let sessao = iniciarConfigurador();
  const respostas = [
    "Clima Boa",
    "Instalação e manutenção de ar-condicionado para casas e lojas pequenas.",
    "Campinas e Valinhos",
    "Segunda a sábado, das 8h às 18h",
    "Instalação de split; limpeza; manutenção corretiva",
    "Nome; cidade e bairro; tipo de imóvel; marca e modelo; sintoma; melhor período",
    "Pedido para falar com uma pessoa; risco elétrico; serviço fora do escopo",
    "Nome; serviço desejado; localização; aparelho; sintoma; período preferido",
    "Diagnóstico definitivo; manipulação de gás; preço não cadastrado",
    "Objetivo e cordial, com mensagens curtas",
    "Vocês parcelam? => Sim, em até 3 vezes no cartão.\nAtendem aos domingos? => Não.",
  ];
  for (const resposta of respostas) sessao = responderPergunta(sessao, resposta);
  return sessao;
}

describe("configurador conversacional de climatização", () => {
  it("inicia com uma única pergunta e um rascunho versionado vazio", () => {
    const sessao = iniciarConfigurador();

    expect(sessao.status).toBe("coletando");
    expect(sessao.pergunta_atual).toEqual({
      id: "nome_do_negocio",
      texto: "Como sua empresa se chama?",
    });
    expect(sessao.spec).toMatchObject({
      schema_version: 1,
      niche: "climatizacao_residencial_pequeno_comercio",
    });
    expect(sessao.respostas).toEqual({});
    expect(sessaoConfiguradorSchema.safeParse(sessao).success).toBe(true);
  });

  it("recusa sessão persistida sem a spec versionada", () => {
    const { spec: _spec, ...semSpec } = iniciarConfigurador();
    expect(sessaoConfiguradorSchema.safeParse(semSpec).success).toBe(false);
  });

  it("guarda somente a resposta explícita e faz a próxima pergunta", () => {
    const sessao = responderPergunta(iniciarConfigurador(), "Clima Boa");

    expect(sessao.spec.business).toEqual({ name: "Clima Boa" });
    expect(sessao.spec.services).toEqual([]);
    expect(sessao.spec.business.opening_hours).toBeUndefined();
    expect(sessao.pergunta_atual?.id).toBe("descricao_do_negocio");
  });

  it("não avança com resposta vazia", () => {
    expect(() => responderPergunta(iniciarConfigurador(), "   ")).toThrow(/resposta/i);
  });

  it("produz uma spec revisável sem acrescentar preço, política ou cobertura", () => {
    const sessao = responderTudo();

    expect(sessao.status).toBe("pronto_para_revisao");
    expect(sessao.pergunta_atual).toBeNull();
    expect(sessao.spec.business).toEqual({
      name: "Clima Boa",
      description: "Instalação e manutenção de ar-condicionado para casas e lojas pequenas.",
      service_area: "Campinas e Valinhos",
      opening_hours: "Segunda a sábado, das 8h às 18h",
    });
    expect(sessao.spec.services).toEqual([
      "Instalação de split",
      "limpeza",
      "manutenção corretiva",
    ]);
    expect(sessao.spec.faq).toEqual([
      { question: "Vocês parcelam?", answer: "Sim, em até 3 vezes no cartão." },
      { question: "Atendem aos domingos?", answer: "Não." },
    ]);
    expect(JSON.stringify(sessao.spec)).not.toMatch(/preço estimado|garantia|24 horas/i);

    const revisada = revisarResposta(sessao, "regiao_atendida", "Somente Campinas");
    expect(revisada.spec.business.service_area).toBe("Somente Campinas");
    expect(revisada.status).toBe("pronto_para_revisao");
  });

  it("só permite confirmar uma spec pronta", () => {
    expect(() => confirmarRevisao(iniciarConfigurador())).toThrow(/incompleta/i);
    expect(confirmarRevisao(responderTudo()).status).toBe("revisado");
  });

  it("explica as lacunas necessárias para a revisão", () => {
    const inicial = avaliarProntidao(iniciarConfigurador().spec);
    expect(inicial.ready).toBe(false);
    expect(inicial.missing).toContain("business.name");
    expect(inicial.missing).toContain("handoff.triggers");

    expect(avaliarProntidao(responderTudo().spec)).toEqual({ ready: true, missing: [] });
  });

  it("gera testes para atendimento normal, limites e passagem para humano", () => {
    const roteiro = gerarRoteiroDeTestes(responderTudo().spec);

    expect(roteiro.map((caso) => caso.id)).toEqual([
      "servico_principal",
      "preco_nao_confirmado",
      "tema_proibido",
      "pedido_de_humano",
      "fora_da_regiao",
    ]);
    expect(roteiro.find((caso) => caso.id === "tema_proibido")?.mensagem).toContain(
      "Diagnóstico definitivo",
    );
    expect(roteiro.find((caso) => caso.id === "pedido_de_humano")?.esperado).toBe("handoff");
  });
});
