/**
 * O WIZARD, PELA TELA, DENTRO DO CI.
 *
 * A jornada de instalação fresca é a P0 da doutrina de QA deste projeto — é o
 * produto que se vende — e é a ÚNICA spec fora do gate, porque depende de WAHA,
 * Redis, Resend e Nuvemshop. O resultado é que o onboarding pôde apodrecer sem
 * nada ficar vermelho: foi assim que oito premissas mortas chegaram até aqui.
 *
 * Esta spec cobre o que dá para cobrir sem esses serviços — que é quase tudo:
 * o wizard inteiro, do login ao "Começar a usar". Fica de fora só o ensaio com
 * resposta de verdade, que precisa de chave de IA com saldo.
 *
 * ISOLAMENTO: cria a PRÓPRIA organização, com o próprio dono. O seed do CI
 * entrega a organização compartilhada já onboardada, e zerar o estado dela para
 * testar o wizard mandaria todas as specs seguintes para dentro do onboarding.
 */
import { randomUUID } from "node:crypto";

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { assertEphemeralRuntime } from "./helpers/ephemeral-runtime";

import { PERGUNTAS_CONFIGURADOR } from "@/lib/onboarding/configurador";
import { RISCO_WHATSAPP_VERSAO } from "@/lib/onboarding/risco-whatsapp";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const SENHA = "WizardQa!2026#Deskcomm";
const email = `wizard-${randomUUID().slice(0, 8)}@qa.local`;

let userId = "";
let orgId = "";
let appUrl = "";

/**
 * O estado que o `install.sh` deixa: dono criado, organização com o nome
 * placeholder, provedor de IA escolhido no terminal, e `onboarded_at` nulo.
 */
test.beforeAll(async ({}, info) => {
  appUrl = String(info.project.use.baseURL ?? `http://localhost:${process.env.E2E_PORT ?? "3001"}`);
  await assertEphemeralRuntime(appUrl, true);
  if (process.env.INTERNAL_AGENT_RUN_STUB !== "true")
    throw new Error("Wizard requires controlled provider, without external calls.");
  const { data: criado, error: errUser } = await svc.auth.admin.createUser({
    email,
    password: SENHA,
    email_confirm: true,
  });
  if (errUser || !criado.user) throw errUser ?? new Error("sem usuário");
  userId = criado.user.id;

  const { data: org, error: errOrg } = await svc
    .from("organizations")
    .insert({
      slug: `minha-empresa-${randomUUID().slice(0, 8)}`,
      display_name: "Minha Empresa",
      legal_name: "Minha Empresa",
      status: "active",
      created_by: userId,
      settings: { llm: { provider: "anthropic" } },
    })
    .select("id")
    .single();
  if (errOrg || !org) throw errOrg ?? new Error("sem org");
  orgId = org.id as string;

  const { error: membershipError } = await svc.from("user_organizations").insert({
    organization_id: orgId,
    user_id: userId,
    role: "admin",
    accepted_at: new Date().toISOString(),
  });
  if (membershipError) throw membershipError;
});

test.afterAll(async () => {
  if (!orgId && !userId) return;
  await assertEphemeralRuntime(appUrl, true);
  const failures: string[] = [];
  const attempt = async (name: string, action: () => PromiseLike<void>) => {
    try {
      await action();
    } catch {
      failures.push(name);
    }
  };
  if (orgId) {
    await attempt("organization deletion", async () => {
      const { error } = await svc.from("organizations").delete().eq("id", orgId);
      if (error) failures.push("organization deletion");
    });
    for (const table of [
      "organizations",
      "ai_agents",
      "ai_agent_versions",
      "ai_agent_runs",
      "ai_provider_credentials",
      "channel_sessions",
      "user_organizations",
    ]) {
      await attempt("cleanup proof: " + table, async () => {
        const { count, error: proofError } = await svc
          .from(table)
          .select("id", { count: "exact", head: true })
          .eq(table === "organizations" ? "id" : "organization_id", orgId);
        if (proofError || count !== 0) failures.push("cleanup proof: " + table);
      });
    }
  }
  if (userId) {
    await attempt("owner deletion", async () => {
      const { error } = await svc.auth.admin.deleteUser(userId);
      if (error && error.status !== 404) failures.push("owner deletion");
    });
    await attempt("owner absence proof", async () => {
      const { data, error: proofError } = await svc.auth.admin.getUserById(userId);
      if (data.user || !proofError || proofError.status !== 404)
        failures.push("owner absence proof");
    });
  }
  expect(failures, "isolated wizard cleanup must finish and prove absence").toEqual([]);
});

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(SENHA);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("o wizard monta um funcionário", () => {
  test("abre mostrando o que a instalação já trouxe, e não pede o nome de novo", async ({
    page,
  }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/welcome/, { timeout: 30_000 });

    // O passo 1 começa pelo que já existe — em vez de um formulário em branco.
    await expect(page.getByText(/já está de pé/i)).toBeVisible();

    // O instalador nunca pergunta o nome do negócio: a organização nasce
    // "Minha Empresa". Mandar isso como valor inicial obrigava a pessoa a
    // apagá-lo, e quem não percebia ficava com o placeholder para sempre.
    await expect(page.locator("#display_name")).toHaveValue("");
  });

  test("o aceite de termos leva a documentos que EXISTEM", async ({ page }) => {
    // O checkbox é obrigatório e linkava duas páginas que respondiam 404.
    for (const href of ["/legal/terms", "/legal/privacy"]) {
      const res = await page.request.get(href);
      expect(res.status(), href).toBe(200);
    }
  });

  test("o nome do negócio chega ao cabeçalho do passo seguinte", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/welcome/, { timeout: 30_000 });

    await page.locator("#display_name").fill("Clínica Bem Viver");
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole("button", { name: /^continuar$/i }).click();
    await page.waitForURL(/\/onboarding\/risco-whatsapp/, { timeout: 30_000 });

    // O layout do wizard é compartilhado entre os passos e não re-renderizava:
    // o cabeçalho seguia dizendo "Minha Empresa" o onboarding inteiro, mesmo
    // com o banco já gravado.
    // `.first()`: há dois <header> na página — o do wizard (com a marca e o
    // nome do negócio) e o do passo. O do layout é o que congelava.
    const cabecalho = page.locator("header").first();
    await expect(cabecalho).toContainText("Clínica Bem Viver");
    await expect(cabecalho).not.toContainText("Minha Empresa");
  });

  test("aceitar o risco é obrigatório antes de escolher a conexão", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/risco-whatsapp/);
    const accept = page.getByRole("button", { name: "Aceitar e conectar meu número" });
    await expect(accept).toBeDisabled();
    await page.locator('input[name="accepted"]').check();
    await accept.click();
    await page.waitForURL(/\/onboarding\/connect-whatsapp/);
    const { data, error } = await svc
      .from("organizations")
      .select("onboarding_state")
      .eq("id", orgId)
      .single();
    expect(error).toBeNull();
    expect(data!.onboarding_state.risco_whatsapp).toMatchObject({ version: RISCO_WHATSAPP_VERSAO });
    expect(data!.onboarding_state.risco_whatsapp.accepted_at).toBeTruthy();
  });
  test("o passo do telefone pergunta COMO se conecta antes de assumir o código", async ({
    page,
  }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/connect-whatsapp/, { timeout: 30_000 });

    // As três formas que o produto realmente suporta — as mesmas da tela de
    // Conexões. Antes, o wizard oferecia uma e nem perguntava: a sessão do
    // canal por código subia sozinha na montagem da tela.
    await expect(page.getByTestId("forma-qr")).toBeVisible();
    await expect(page.getByTestId("forma-oficial")).toBeVisible();
    await expect(page.getByTestId("forma-parceiro")).toBeVisible();

    // Nenhuma escolha feita: o código não pode estar na tela ainda.
    await expect(page.locator('img[src*="/whatsapp/qr"]')).toHaveCount(0);

    // A cópia visível fala a língua de quem vende, nunca a do transporte.
    const corpo = page.locator("body");
    await expect(corpo).not.toContainText(/provider/i);
    await expect(corpo).not.toContainText(/channel_session/i);

    // Escolher a conta oficial leva ao formulário dela, e dá para voltar —
    // escolher errado não pode ser uma porta que tranca.
    await page.getByTestId("forma-oficial").locator("input").click();
    await expect(page.getByTestId("canal-oficial-root")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("voltar-para-escolha").click();
    await expect(page.getByTestId("forma-qr")).toBeVisible();

    // NÃO avança: a spec é serial e o caso seguinte começa neste mesmo passo.
    // A escolha vive em memória e não é gravada, então voltar aqui não deixa
    // rastro — se deixasse, o passo já contaria como cumprido.
  });

  test("o passo do telefone não expõe identificador interno nem enum", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/connect-whatsapp/, { timeout: 30_000 });

    const corpo = page.locator("body");
    // Mostrava "Sessão: org_f3d61bc0" e "Status: INIT".
    await expect(corpo).not.toContainText(/Sessão:/i);
    await expect(corpo).not.toContainText(/Status:\s*(INIT|STARTING|SCAN_QR_CODE|WORKING)/);
    // E nunca mais manda rodar Docker nem aponta para um menu que não existe.
    await expect(corpo).not.toContainText(/docker compose/i);
    await expect(corpo).not.toContainText(/Configurações → Canais/i);

    await page.getByRole("button", { name: /pular por enquanto/i }).click();
    await page.waitForURL(/\/onboarding\/configurar-atendimento/, { timeout: 30_000 });
  });

  test("configurar coleta as respostas e exige revisão antes de treinar", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/configurar-atendimento/);
    const answers: Record<string, string> = {
      nome_do_negocio: "Clínica Bem Viver",
      descricao_do_negocio: "Consultas e atendimentos agendados",
      regiao_atendida: "São Paulo",
      horario_de_atendimento: "Segunda a sexta, 8h às 18h",
      servicos: "Consulta; retorno",
      qualificacao: "Nome; tipo de atendimento",
      passagem_para_humano: "Emergência; pedido de uma pessoa",
      resumo_para_humano: "Nome; motivo; horário desejado",
      temas_proibidos: "Não diagnosticar; não inventar disponibilidade",
      tom_de_voz: "Objetivo e cordial",
      perguntas_frequentes: "Atende sábado? => Não, somente segunda a sexta.",
    };
    for (const question of PERGUNTAS_CONFIGURADOR) {
      const input = page.getByLabel(question.texto, { exact: true });
      await expect(input).toBeVisible();
      await input.fill(answers[question.id]!);
      await page.getByRole("button", { name: "Responder e continuar", exact: true }).click();
      await expect(input).not.toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Pronto para sua revisão" })).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding\/configurar-atendimento/);
    await page.getByRole("button", { name: "Aprovar configuração" }).click();
    await page.waitForURL(/\/onboarding\/setup-ai/);
    const { data, error } = await svc
      .from("organizations")
      .select("onboarding_state")
      .eq("id", orgId)
      .single();
    expect(error).toBeNull();
    expect(data!.onboarding_state.configurador_atendimento.session.status).toBe("revisado");
    expect(data!.onboarding_state.configurador_atendimento.session.spec.business.name).toBe(
      "Clínica Bem Viver",
    );
  });
  test("treinar mostra o cérebro dele — e sem chave não é um beco", async ({ page }) => {
    // Vale nos dois mundos pela mesma razão do caso do quadro (ver lá): no CI
    // não há chave de provedor e o bloco vira o formulário para colar uma; na
    // máquina de quem desenvolve, `next start` carrega o `.env.local` e ele vira
    // o veredito sobre a chave que existe.
    //
    // O que NÃO varia: a tela nunca deixa a pessoa sabendo que falta a chave sem
    // dizer o que fazer. Antes o passo 1 escrevia "Falta a chave da inteligência
    // artificial" e o assunto morria ali — diagnóstico certo, saída nenhuma.
    await login(page);
    await page.waitForURL(/\/onboarding\/setup-ai/, { timeout: 30_000 });

    const corpo = page.locator("body");
    await expect(corpo).toContainText(/cérebro/i);

    const semChave = await page.locator("#api_key_da_ia").count();
    if (semChave > 0) {
      // O beco vira saída: o campo está aqui, no passo em que a chave importa.
      await expect(page.locator("#provedor_da_ia")).toBeVisible();
      await expect(page.getByRole("button", { name: /guardar a chave/i })).toBeDisabled();
      await expect(corpo).toContainText(/guardada cifrada/i);
    } else {
      // Com chave, o passo DIZ qual é e confere o crédito — "validada" nunca
      // significou "funciona": o validador bate num endpoint de listagem, que
      // responde 200 com a conta zerada.
      await expect(corpo).toContainText(
        /Conferindo se a chave tem crédito|Testei agora|não passou|Não consegui testar/i,
      );
    }
  });

  test("treinar: pede as regras da casa e mostra o que ele já sabe fazer", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/setup-ai/, { timeout: 30_000 });

    await expect(page.getByRole("heading", { name: /treine seu funcionário/i })).toBeVisible();
    // As duas listas que não pedem configuração nenhuma.
    await expect(page.getByText(/ele já vem sabendo/i)).toBeVisible();
    await expect(page.getByText(/e nunca vai fazer/i)).toBeVisible();

    await page.locator("#name").fill("Bia");
    await page.locator("#regras_da_casa").fill("Horário: 8h às 18h. Nunca prometa desconto.");
    await page.getByRole("button", { name: /criar e continuar/i }).click();

    // ⚠️ DOIS DESFECHOS LEGÍTIMOS, e o teste tem de aceitar os dois — foi aqui
    // que ele reprovou no CI depois de passar em toda máquina com chave.
    //
    // COM chave (a máquina de quem desenvolve, onde `next start` carrega o
    // `.env.local`): o agente é publicado e o wizard avança para o quadro. O
    // passo novo não pode ser pulado no caminho de sucesso — era o que o destino
    // fixo da action fazia, e é o que esta asserção guarda.
    //
    // SEM chave (o CI, e toda instalação que ainda não configurou provedor): o
    // atendente é criado como RASCUNHO e o wizard PARA para dizer isso. Avançar
    // calado deixaria a pessoa achar que o funcionário está no ar. O que se
    // cobra aqui é que a tela explique E ofereça saída — sem o botão, o passo
    // vira um beco, que foi o defeito que esta reprovação revelou.
    const avancou = await page
      .waitForURL(/\/onboarding\/funil/, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);

    if (!avancou) {
      // O que se cobra NÃO é qual causa impediu a publicação — são três (sem
      // canal, sem modelo no catálogo, sem chave) e a instalação decide qual
      // aparece. O que vale para todas: o passo não avança calado, diz que o
      // atendente ficou RASCUNHO, e oferece seguir. Amarrar a asserção a uma
      // frase de causa faria o teste reprovar quando a instalação tivesse a
      // outra — sobre uma tela igualmente correta.
      await expect(page.getByRole("alert").first()).toContainText(/rascunho/i);
      await page.getByRole("button", { name: /continuar sem publicar/i }).click();
      await page.waitForURL(/\/onboarding\/funil/, { timeout: 30_000 });
    }
  });

  test("o quadro chega montado, venha da IA ou de um modelo pronto", async ({ page }) => {
    // ⚠️ ESTE CASO VALE NOS DOIS MUNDOS, DE PROPÓSITO. No CI não há chave de
    // provedor nenhum e a sugestão cai no quadro pronto; na máquina de quem
    // desenvolve, `next start` carrega o `.env.local` sozinho e a chave real
    // chega ao servidor sob teste — então a MESMA spec via a IA responder aqui e
    // o pacote no CI. Fixar uma das duas origens faria o gate vermelhar conforme
    // a máquina, que é o pior tipo de teste: o que ensina a ignorá-lo.
    //
    // O que NÃO varia é o que este passo promete: a pessoa nunca fica sem
    // quadro, e a tela diz de onde ele veio.
    await login(page);
    await page.waitForURL(/\/onboarding\/funil/, { timeout: 30_000 });

    const corpo = page.locator("body");
    await expect(
      corpo,
      "a tela precisa dizer se a sugestão veio da IA ou de um modelo pronto",
    ).toContainText(/montou este quadro|não consegui pedir uma sugestão/i);

    // O quadro está lá, montado, com o destino de cada coluna visível — que é a
    // metade invisível do defeito: medido, 312 etapas no banco e 4 com destino,
    // o que deixa o assistente incapaz de mover um card.
    const colunas = page.locator('input[aria-label^="Nome da coluna"]');
    expect(await colunas.count()).toBeGreaterThanOrEqual(4);
    await expect(corpo).toContainText(/Ele move o cliente para cá quando fechou negócio/i);
    await expect(corpo).toContainText(/Ele move o cliente para cá quando não fechou/i);

    // As colunas de desfecho não podem ser removidas: sem elas o banco recusa o
    // quadro inteiro, e descobrir isso no clique de salvar seria pior.
    await expect(page.getByText("obrigatória").first()).toBeVisible();

    // E o que a instalação trouxe fica à vista, para a troca não parecer mágica.
    await expect(corpo).toContainText(/Carrinho abandonado/);
  });

  test("dá para trocar por um modelo pronto sem depender de IA nenhuma", async ({ page }) => {
    // O caminho determinístico do plano B, que não depende de haver chave: é o
    // que sobra para quem instalou e ainda não configurou provedor — e para
    // quem simplesmente não gostou da sugestão.
    await login(page);
    await page.waitForURL(/\/onboarding\/funil/, { timeout: 30_000 });

    await page.getByRole("button", { name: /modelo pronto/i }).click();
    await page.getByRole("button", { name: /clínica, consultório ou salão/i }).click();

    await expect(page.locator("#nome_do_quadro")).toHaveValue("Agendamentos");
    await expect(page.locator('input[aria-label="Nome da coluna 1"]')).toHaveValue("Novo contato");
  });

  test("coluna sem nome barra o salvar, em vez de sumir calada", async ({ page }) => {
    // `normalizarProposta` DESCARTA nome vazio. Sem esta trava, a pessoa
    // acrescenta uma coluna, esquece de nomeá-la, salva, avança — e a coluna
    // simplesmente não existe.
    await login(page);
    await page.waitForURL(/\/onboarding\/funil/, { timeout: 30_000 });

    // Abre espaço primeiro. O teto de colunas é real e o botão desabilita nele:
    // localmente a sugestão da IA às vezes já chega com as 8, e um teste que
    // assumisse espaço livre vermelharia conforme a resposta do modelo. Remover
    // antes de acrescentar também é o que o dono faz — tira o que não serve e
    // põe o que falta.
    await page
      .getByRole("button", { name: /^remover$/i })
      .last()
      .click();
    await page.getByRole("button", { name: /adicionar coluna/i }).click();
    await expect(page.getByText(/dê um nome à coluna em branco/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /usar este quadro/i })).toBeDisabled();

    // Nomeada, o caminho destrava.
    await page.locator('input[aria-label^="Nome da coluna"]').last().fill("Confirmação da véspera");
  });

  test("salvar troca o funil de e-commerce e ENSINA o destino de cada coluna", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/funil/, { timeout: 30_000 });
    await page.getByRole("button", { name: /usar este quadro/i }).click();
    await page.waitForURL(/\/onboarding\/testar/, { timeout: 30_000 });

    const { data: funil } = await svc
      .from("crm_pipelines")
      .select("id, name")
      .eq("organization_id", orgId)
      .eq("is_default", true)
      .maybeSingle();

    const { data: etapas } = await svc
      .from("crm_stages")
      .select("name, agent_stage_hint, is_won, is_lost")
      .eq("pipeline_id", funil!.id)
      .order("position");

    const nomes = (etapas ?? []).map((e) => String(e.name));
    // O quadro que o gatilho semeia em TODA organização, num produto que se
    // vende como multi-nicho: a clínica abria o quadro dela e lia isto.
    expect(nomes).not.toContain("Carrinho abandonado");
    expect(nomes).not.toContain("Em separação");
    expect(String(funil!.name)).not.toBe("Pedidos");

    // A metade invisível: sem destino, o funcionário tem o funil no escopo e
    // não sabe o que significa nenhuma coluna.
    const comDestino = (etapas ?? []).filter((e) => e.agent_stage_hint !== null);
    expect(comDestino.length).toBeGreaterThanOrEqual(5);
    // Uma de ganho e uma de perda, e o destino delas COERENTE com a marcação —
    // é o que o CHECK `crm_stages_hint_coerente_com_won_lost` cobra.
    expect((etapas ?? []).filter((e) => e.is_won)).toHaveLength(1);
    expect((etapas ?? []).filter((e) => e.is_lost)).toHaveLength(1);
    for (const e of etapas ?? []) {
      expect(e.is_won, String(e.name)).toBe(e.agent_stage_hint === "won");
      expect(e.is_lost, String(e.name)).toBe(e.agent_stage_hint === "lost");
    }
  });

  test("as regras da casa viraram memória da organização, não prompt do agente", async () => {
    const { data: mem } = await svc
      .from("org_memory_versions")
      .select("content")
      .eq("organization_id", orgId)
      .limit(1)
      .maybeSingle();
    // A MEMÓRIA É GRAVADA EM QUALQUER DESFECHO, e é o ponto principal: ela vale
    // para a organização, não para este agente, então nasce mesmo quando a
    // publicação não acontece. Se dependesse da chave, quem instalou sem
    // provedor perderia o que escreveu.
    expect(mem?.content).toContain("Nunca prometa desconto");

    // O agente EXISTE sempre; o que depende da chave é a VERSÃO publicada.
    const { data: agente } = await svc
      .from("ai_agents")
      .select("kind, system_prompt")
      .eq("organization_id", orgId)
      .limit(1)
      .maybeSingle();
    expect(agente?.kind, "nasce no formato atual, não no rag_bot legado").toBe("mcp_agent");
    // As regras não entram no prompt DELE: a segunda contratação nasceria sem elas.
    expect(agente?.system_prompt).not.toContain("Nunca prometa desconto");

    const { data: versao } = await svc
      .from("ai_agent_versions")
      .select("system_prompt, provider, tool_ids, pipeline_ids,status,credential_id")
      .eq("organization_id", orgId)
      .limit(1)
      .maybeSingle();

    // Current onboarding saves an inert version before asking for a credential;
    // creating this draft never publishes the agent or calls an external model.
    expect(versao).toMatchObject({ status: "draft", credential_id: null, provider: "anthropic" });
    expect(versao!.system_prompt).not.toContain("Nunca prometa desconto");
    expect((versao!.tool_ids as string[])?.length ?? 0).toBeGreaterThan(0);
  });

  test("o wizard termina apresentando o sistema, e o resumo não acusa passo inexistente", async ({
    page,
  }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/testar/, { timeout: 30_000 });

    const countMessages = async () => {
      const { count, error } = await svc
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId);
      expect(error).toBeNull();
      return count;
    };
    const before = await countMessages();
    await page.getByRole("button", { name: /^continuar$/i }).click();
    await expect(page.getByText("Faça um ensaio com resposta antes de continuar.")).toBeVisible();
    const reply = page.waitForResponse(
      (res) =>
        /\/versions\/[^/]+\/test$/.test(new URL(res.url()).pathname) &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Mandar mensagem", exact: true }).click();
    const response = await reply;
    expect(response.ok()).toBe(true);
    const { data: result } = await response.json();
    expect(result).toMatchObject({ stub: true, status: "ok" });
    expect(result.final_text.trim()).not.toBe("");
    await expect(page.getByText(result.final_text, { exact: true })).toBeVisible();
    const { data: run, error: runError } = await svc
      .from("ai_agent_runs")
      .select("id,agent_id,agent_version_id,status,is_dry_run,completed_at")
      .eq("organization_id", orgId)
      .eq("id", result.run_id)
      .single();
    expect(runError).toBeNull();
    expect(run).toMatchObject({ status: "completed", is_dry_run: true });
    expect(run!.completed_at).toBeTruthy();
    expect(await countMessages()).toBe(before);
    await page.getByRole("button", { name: /^continuar$/i }).click();
    await page.waitForURL(/\/onboarding\/ativar/);
    const activation = page.getByRole("button", { name: "Ativar agente agora", exact: true });
    await activation.click();
    await expect(page.getByRole("alert")).toContainText("Não foi possível ativar");
    const { data: agent, error: agentError } = await svc
      .from("ai_agents")
      .select("published_version_id")
      .eq("organization_id", orgId)
      .eq("id", run!.agent_id)
      .single();
    expect(agentError).toBeNull();
    expect(agent!.published_version_id).toBeNull();
    // Only in the guarded ephemeral runtime: synthetic credential, unpaired
    // channel and empty phone allowlist. No external key or number is used.
    const { data: version, error: versionError } = await svc
      .from("ai_agent_versions")
      .select("provider")
      .eq("organization_id", orgId)
      .eq("id", run!.agent_version_id)
      .single();
    expect(versionError).toBeNull();
    const { data: credential, error: credentialError } = await svc
      .from("ai_provider_credentials")
      .insert({
        organization_id: orgId,
        provider: version!.provider,
        label: "Sandbox wizard QA",
        api_key_encrypted: "\\x00",
        api_key_iv: "\\x00",
        api_key_tag: "\\x00",
        api_key_last4: "test",
        is_active: true,
        validated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    expect(credentialError).toBeNull();
    const { data: channel, error: channelError } = await svc
      .from("channel_sessions")
      .insert({
        organization_id: orgId,
        provider: "waha",
        session_name: `qa_wizard_${randomUUID().slice(0, 8)}`,
        status: "WORKING",
        metadata: { ai_gate: "allowlist", ai_test_phone_numbers: [] },
      })
      .select("id")
      .single();
    expect(channelError).toBeNull();
    const { error: bindError } = await svc
      .from("ai_agent_versions")
      .update({ credential_id: credential!.id, channel_session_id: channel!.id })
      .eq("organization_id", orgId)
      .eq("id", run!.agent_version_id);
    expect(bindError).toBeNull();
    await activation.click();
    await page.waitForURL(/\/onboarding\/invite-team/, { timeout: 30_000 });
    expect(await countMessages()).toBe(before);
    await page.getByRole("button", { name: /pular por enquanto/i }).click();
    await page.waitForURL(/\/onboarding\/done/, { timeout: 30_000 });

    // O tour: as peças apresentadas pelo que fazem.
    await expect(page.getByText(/o que mais tem aqui/i)).toBeVisible();
    await expect(page.getByText(/voltar a falar com quem sumiu/i)).toBeVisible();

    // A integração de loja vem desligada: o passo não existe nesta instalação,
    // e o resumo listava "Loja Nuvemshop (pulado)" — acusando a pessoa de não
    // fazer o que ninguém lhe ofereceu.
    await expect(page.locator("body")).not.toContainText(/Nuvemshop/i);

    await page.getByRole("button", { name: /começar a usar/i }).click();
    await page.waitForURL(/\/app\//, { timeout: 30_000 });

    const { data: org } = await svc
      .from("organizations")
      .select("onboarded_at, display_name")
      .eq("id", orgId)
      .maybeSingle();
    expect(org?.onboarded_at).toBeTruthy();
    expect(org?.display_name).toBe("Clínica Bem Viver");
  });
});
