/**
 * O wizard não pode culpar a pessoa por uma tela que nunca lhe ofereceu.
 *
 * Em 100% das instalações pelo kit a integração de loja vem desligada. Mesmo
 * assim o indicador mostrava o passo "Loja", ele aparecia CONCLUÍDO enquanto a
 * pessoa estava no passo seguinte, e a tela final listava "Loja Nuvemshop
 * (pulado)". Três listas independentes discordando entre si.
 */
import { describe, expect, it } from "vitest";

import {
  passosVisiveis,
  proximoPasso,
  resumoDoOnboarding,
  type ContextoDoPasso,
} from "@/lib/onboarding/passos";
import type { OnboardingState } from "@/lib/schemas/onboarding";

const SEM_LOJA: ContextoDoPasso = { lojaLigada: false };
const COM_LOJA: ContextoDoPasso = { lojaLigada: true };

const VAZIO: OnboardingState = {};
const SESSAO_REVISADA = {
  status: "revisado" as const,
  pergunta_atual: null,
  respostas: {},
  spec: {
    schema_version: 1 as const,
    niche: "climatizacao_residencial_pequeno_comercio" as const,
    business: {
      name: "Clima Boa",
      description: "Instalação e manutenção de ar-condicionado.",
      service_area: "Campinas",
      opening_hours: "Segunda a sábado",
    },
    services: ["Instalação"],
    qualification: ["Cidade e bairro"],
    handoff: { triggers: ["Pedido humano"], summary_fields: ["Serviço"] },
    forbidden_topics: ["Diagnóstico definitivo"],
    tone: "Objetivo e cordial",
    faq: [],
  },
};

describe("passos visíveis", () => {
  it("instalação pelo kit não vê passo de loja em lugar nenhum", () => {
    const segmentos = passosVisiveis(SEM_LOJA).map((p) => p.segmento);
    expect(segmentos).not.toContain("connect-nuvemshop");
  });

  it("quem liga a integração vê o passo (a regra não é 'esconder sempre')", () => {
    const segmentos = passosVisiveis(COM_LOJA).map((p) => p.segmento);
    expect(segmentos).toContain("connect-nuvemshop");
  });

  it("a ordem é a mesma nos dois casos, menos o passo que não existe", () => {
    expect(passosVisiveis(SEM_LOJA).map((p) => p.segmento)).toEqual([
      "welcome",
      "risco-whatsapp",
      "connect-whatsapp",
      "configurar-atendimento",
      "setup-ai",
      // O quadro de clientes vem DEPOIS de treinar: a sugestão sai da chave que
      // a pessoa acabou de confirmar funcionando, e é o mesmo modelo que vai
      // atender. Pedi-lo antes obrigaria a montá-lo no escuro.
      "funil",
      // Ver o funcionário atender vem DEPOIS de treiná-lo e ANTES de chamar o
      // time: é a prova de que ele funciona, e ela precisa acontecer enquanto a
      // pessoa ainda está no wizard.
      "testar",
      "ativar",
      "invite-team",
    ]);
  });
});

describe("próximo passo", () => {
  it("começa no primeiro", () => {
    expect(proximoPasso(VAZIO, SEM_LOJA)?.segmento).toBe("welcome");
  });

  it("pula o passo que não existe, em vez de travar nele", () => {
    // O defeito equivalente do lado do roteador: parar num passo que a
    // instalação não oferece deixaria a pessoa presa sem entender por quê.
    const s: OnboardingState = {
      welcome: { accepted_at: "x", timezone: "America/Sao_Paulo", display_name: "N" },
      risco_whatsapp: { accepted_at: "x", version: "2026-10-01" },
      whatsapp: { status: "WORKING" },
    };
    expect(proximoPasso(s, SEM_LOJA)?.segmento).toBe("configurar-atendimento");
    expect(proximoPasso(s, COM_LOJA)?.segmento).toBe("connect-nuvemshop");
  });

  it("passo PULADO conta como resolvido — senão o wizard entra em laço", () => {
    const s: OnboardingState = {
      welcome: { accepted_at: "x", timezone: "America/Sao_Paulo", display_name: "N" },
      risco_whatsapp: { accepted_at: "x", version: "2026-10-01" },
      whatsapp: { status: "skipped", skipped: true },
    };
    expect(proximoPasso(s, SEM_LOJA)?.segmento).toBe("configurar-atendimento");
  });

  it("tudo resolvido = não falta nenhum", () => {
    const s: OnboardingState = {
      welcome: { accepted_at: "x", timezone: "America/Sao_Paulo", display_name: "N" },
      risco_whatsapp: { accepted_at: "x", version: "2026-10-01" },
      whatsapp: { status: "WORKING" },
      configurador_atendimento: {
        session: SESSAO_REVISADA,
        updated_at: "2026-10-01T22:00:00.000Z",
        approved_at: "2026-10-01T22:00:00.000Z",
      },
      ai: { agent_id: "a", prompt_template: "p" },
      funil: { pipeline_id: "f", origem: "ia", etapas: 6 },
      teste: { respondeu: true },
      ativacao: {
        agent_id: "33333333-3333-4333-8333-333333333333",
        version_id: "44444444-4444-4444-8444-444444444444",
        activated_at: "2026-10-01T22:00:00.000Z",
      },
      team: { invites_sent: 0, skipped: true },
    };
    expect(proximoPasso(s, SEM_LOJA)).toBeNull();
  });
});

describe("resumo final", () => {
  it("NÃO lista o passo que a instalação nunca ofereceu", () => {
    // O defeito original: a tela final acusava "Loja Nuvemshop (pulado)".
    const resumo = resumoDoOnboarding(VAZIO, SEM_LOJA);
    expect(resumo.map((i) => i.segmento)).not.toContain("connect-nuvemshop");
  });

  it("distingue feito de pulado — pular é escolha, não falha", () => {
    const s: OnboardingState = {
      welcome: { accepted_at: "x", timezone: "America/Sao_Paulo", display_name: "N" },
      risco_whatsapp: { accepted_at: "x", version: "2026-10-01" },
      whatsapp: { status: "skipped", skipped: true },
    };
    const resumo = resumoDoOnboarding(s, SEM_LOJA);
    const porSegmento = new Map(resumo.map((i) => [i.segmento, i]));
    expect(porSegmento.get("welcome")).toMatchObject({ feito: true, pulado: false });
    expect(porSegmento.get("connect-whatsapp")).toMatchObject({ feito: false, pulado: true });
    // O que nem chegou a ser oferecido não é "pulado": é pendente.
    expect(porSegmento.get("setup-ai")).toMatchObject({ feito: false, pulado: false });
  });

  it("os rótulos nomeiam PEÇAS do funcionário, não telas do sistema", () => {
    // A moldura do redesenho. Um passo chamado "IA" não diz o que vai
    // acontecer ali; "Treinar" diz.
    const rotulos = resumoDoOnboarding(VAZIO, SEM_LOJA).map((i) => i.rotulo);
    expect(rotulos).toContain("O telefone dele");
    expect(rotulos).toContain("Como ele se conecta");
    expect(rotulos).toContain("Como ele atende");
    expect(rotulos).toContain("Treinar");
    expect(rotulos).not.toContain("IA");
  });
});
