/**
 * J1 — Onboarding do primeiro usuário numa instalação FRESCA (estilo VPS).
 *
 * Pré-condições (ambiente que simula o kit self-host):
 *   - banco zerado do baseline.sql (Supabase local pg17)
 *   - primeiro usuário criado via scripts/bootstrap-owner.ts (como o install.sh)
 *   - WAHA ativo, Redis local, RESEND_API_KEY VAZIO (realidade da VPS fresca)
 *   - SEM chave de IA na instalação; o provedor controlado do CI ensaia o
 *     rascunho. Uma credencial sintética é acrescentada somente ao testar
 *     ativação, sem conectar número real ou chamar um provedor externo.
 *   - app em produção (next build + next start) na E2E_PORT
 *
 * Casos: J1.1–J1.13 do docs/testing/user-journey-map.md. Tudo pelo frontend;
 * banco só para PROVAR estado (nunca para atalhar a jornada).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { assertEphemeralRuntime } from "./helpers/ephemeral-runtime";

import { PERGUNTAS_CONFIGURADOR } from "@/lib/onboarding/configurador";
import { RISCO_WHATSAPP_VERSAO } from "@/lib/onboarding/risco-whatsapp";
import { seedPlatformPlaybook } from "@/lib/agent-engine/agent/playbook-seed";

import { generateTotp, msUntilNextTotpWindow } from "./utils/totp";

const OWNER_EMAIL = "dono@qa.local";
const OWNER_PASSWORD = "QaVps!2026#Dono";
const OWNER_STATE_PATH = path.join(process.cwd(), ".e2e-owner.json");
const EVIDENCE_DIR = path.join(process.cwd(), ".superpowers/evidence/vps-qa");


const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/**
 * A ORGANIZACAO DO DONO — resolvida por QUEM ELA E, nunca por "a primeira".
 *
 * Este seletor era `.limit(1).single()` sem filtro nenhum: pegava a primeira
 * organizacao que o Postgres devolvesse. Num banco recem-semeado isso funciona
 * por acidente — a unica org existente e a do teste. Num banco que ja tem uso,
 * a primeira e OUTRA, e o `beforeAll` desta suite entao zerava `onboarded_at`,
 * apagava `ai_agents` e apagava `channel_sessions` DELA.
 *
 * Medido em 2026-09-03, numa instalacao de trabalho: a organizacao real perdeu
 * o onboarding e caiu no wizard, e a sessao de WhatsApp conectada foi apagada.
 * O sintoma que apareceu primeiro foi outro e nao apontava para ca — duas specs
 * de webhooks falhando porque o link sumia da barra lateral, que e o que o
 * layout faz quando a org nao esta onboarded.
 *
 * A correcao amarra a org ao DONO do bootstrap (`OWNER_EMAIL`), que e de quem
 * esta suite fala. Se ele nao existir, falha alto: um teste destrutivo que nao
 * sabe em quem esta mexendo deve parar, nunca escolher alguem.
 */
async function orgRow(): Promise<{
  id: string;
  display_name: string;
  timezone: string | null;
  onboarded_at: string | null;
  onboarding_state: Record<string, unknown> | null;
}> {
  const { data: users, error: erroUsuarios } = await svc.auth.admin.listUsers();
  if (erroUsuarios) throw erroUsuarios;
  const dono = users?.users.find((u) => u.email === OWNER_EMAIL);
  if (!dono) {
    throw new Error(
      `esta suite APAGA dados da organizacao que resolver aqui, e nao achou o dono ` +
        `(${OWNER_EMAIL}). Sem saber em quem mexer, ela para — escolher "a primeira" ` +
        `ja custou o onboarding e a sessao de WhatsApp de uma instalacao real.`,
    );
  }

  const { data: vinculo, error: erroVinculo } = await svc
    .from("user_organizations")
    .select("organization_id")
    .eq("user_id", dono.id)
    .is("revoked_at", null)
    .limit(1)
    .single();
  if (erroVinculo) throw erroVinculo;

  const { data, error } = await svc
    .from("organizations")
    .select("id, display_name, timezone, onboarded_at, onboarding_state")
    .eq("id", (vinculo as { organization_id: string }).organization_id)
    .single();
  if (error) throw error;
  return data as never;
}

async function snap(page: Page, name: string): Promise<void> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: true });
}

async function login(page: Page, password = OWNER_PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(OWNER_EMAIL);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.describe("J1 — onboarding do dono numa instalação fresca", () => {
  test.beforeAll(async ({}, info) => {
    await assertEphemeralRuntime(
      String(info.project.use.baseURL ?? `http://localhost:${process.env.E2E_PORT ?? "3001"}`),
      true,
      true,
    );
    // O CI não sobe o worker: reproduz somente seu bootstrap oficial,
    // sem laços de consumo ou envio. O DSN foi vinculado ao mesmo DB efêmero.
    const bootstrapPool = new pg.Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
    try {
      await seedPlatformPlaybook(bootstrapPool);
    } finally {
      await bootstrapPool.end();
    }
    // Reset ao estado recém-bootstrapado (re-runs idempotentes): wizard zerado,
    // sem agente, sem canal, sem fatores MFA do dono.
    const org = await orgRow();
    const { data: oldChannels, error: oldChannelsError } = await svc
      .from("channel_sessions")
      .select("waha_session_name")
      .eq("organization_id", org.id);
    if (oldChannelsError) throw oldChannelsError;
    const ownedSessions = new Set((oldChannels ?? []).map((channel) => channel.waha_session_name));
    await svc
      .from("organizations")
      .update({ onboarding_state: {}, onboarded_at: null })
      .eq("id", org.id);
    await svc.from("ai_agents").delete().eq("organization_id", org.id);
    await svc.from("channel_sessions").delete().eq("organization_id", org.id);

    const { data: users } = await svc.auth.admin.listUsers();
    const owner = users?.users.find((u) => u.email === OWNER_EMAIL);
    if (owner) {
      const { data: factors } = await svc.auth.admin.mfa.listFactors({ userId: owner.id });
      for (const f of factors?.factors ?? []) {
        await svc.auth.admin.mfa.deleteFactor({ id: f.id, userId: owner.id });
      }
    }
    if (fs.existsSync(OWNER_STATE_PATH)) fs.rmSync(OWNER_STATE_PATH);

    // WAHA: remove sessões org_* de rodadas anteriores (instalação fresca não
    // teria sessão FAILED pendurada; QR não re-renderiza sobre sessão morta).
    const wahaBase = process.env.WAHA_API_BASE_URL;
    const wahaKey = process.env.WAHA_API_KEY;
    if (wahaBase && wahaKey) {
      const res = await fetch(`${wahaBase}/api/sessions?all=true`, {
        headers: { "X-Api-Key": wahaKey },
      }).catch(() => null);
      const sessions = res?.ok ? ((await res.json()) as Array<{ name: string }>) : [];
      for (const s of sessions) {
        if (!ownedSessions.has(s.name)) continue;
        await fetch(`${wahaBase}/api/sessions/${s.name}`, {
          method: "DELETE",
          headers: { "X-Api-Key": wahaKey },
        }).catch(() => null);
      }
    }
  });

  test("J1.2 senha errada → mensagem clara, sem stack", async ({ page }) => {
    await login(page, "senha-errada-123");
    await expect(page.getByText(/email ou senha incorretos/i)).toBeVisible({ timeout: 10_000 });
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/error:|stack|exception/i);
    await snap(page, "j1.2-senha-errada");
  });

  test("J1.1 login do bootstrap cai no wizard (org sem onboarded_at)", async ({ page }) => {
    const before = await orgRow();
    expect(before.onboarded_at).toBeNull();
    await login(page);
    await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/onboarding\/welcome/);
    await snap(page, "j1.1-welcome");
  });

  test("J1.12 /app/inbox antes de concluir → volta pro onboarding", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding/);
    await page.goto("/app/inbox");
    await page.waitForURL(/\/onboarding/, { timeout: 15_000 });
  });

  test("J1.3 + J1.4 welcome: termos obrigatórios; salva nome/timezone e avança", async ({
    page,
  }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/welcome/);

    // J1.3 — sem aceitar os termos o botão fica desabilitado
    const continuar = page.getByRole("button", { name: /continuar/i });
    await expect(continuar).toBeDisabled();

    // J1.4 — preenche e avança
    await page.locator("#display_name").fill("Loja QA VPS");
    await page.locator('input[type="checkbox"]').check();
    await expect(continuar).toBeEnabled();
    await continuar.click();
    await page.waitForURL(/\/onboarding\/risco-whatsapp/, { timeout: 20_000 });
    await snap(page, "j1.4-risco-whatsapp");

    const org = await orgRow();
    expect(org.display_name).toBe("Loja QA VPS");
    expect(org.timezone).toBe("America/Sao_Paulo");
    expect((org.onboarding_state as { welcome?: unknown })?.welcome).toBeTruthy();
  });

  test("ciência do risco é obrigatória e registra a versão aceita", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/risco-whatsapp/);
    const accept = page.getByRole("button", { name: "Aceitar e conectar meu número" });
    await expect(accept).toBeDisabled();
    await expect(page.getByText(/conexão experimental durante o beta/i)).toBeVisible();
    await page.locator('input[name="accepted"]').check();
    await accept.click();
    await page.waitForURL(/\/onboarding\/connect-whatsapp/);
    const state = (await orgRow()).onboarding_state as {
      risco_whatsapp?: { accepted_at?: string; version?: string };
    };
    expect(state.risco_whatsapp?.accepted_at).toBeTruthy();
    expect(state.risco_whatsapp?.version).toBe(RISCO_WHATSAPP_VERSAO);
  });

  test("J1.5 WAHA ativo → QR code aparece de verdade", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/connect-whatsapp/);

    // O passo agora ABRE PERGUNTANDO como a pessoa já usa o número — o código
    // deixou de ser suposição. Escolher "leio um código com o celular" é o que
    // sobe a sessão; antes ela subia sozinha na montagem da tela, e quem tinha
    // conta oficial entrava pelo caminho errado sem ter sido perguntado.
    await page.getByTestId("forma-qr").locator("input").click();

    // sem banner de "WAHA não está configurado"
    // O nome do transporte saiu da tela: o aviso agora fala do "WhatsApp desta
    // instalação", que é como o dono chama a coisa.
    await expect(page.getByText(/ainda não subiu/i)).toHaveCount(0);

    // QR do proxy (poll de 3s até SCAN_QR_CODE) — imagem carregada de fato
    const qr = page.locator('img[src*="/whatsapp/qr"]');
    await expect(qr).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => qr.evaluate((el: HTMLImageElement) => el.naturalWidth), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await snap(page, "j1.5-qr-visivel");
  });

  test("J1.11 + J1.6 abandona e volta → retoma no step pendente; pular WhatsApp avança", async ({
    page,
  }) => {
    // sessão nova (simula fechar o browser): retoma exatamente no connect-whatsapp
    await login(page);
    await page.waitForURL(/\/onboarding\/connect-whatsapp/, { timeout: 20_000 });

    // Com Nuvemshop desabilitado (VPS fresca), pular o WhatsApp deve cair
    // DIRETO no configurador — nunca num step oculto (bug corrigido: as actions
    // redirecionavam hardcoded pro connect-nuvemshop).
    await page.getByRole("button", { name: /pular por enquanto/i }).click();
    await page.waitForURL(/\/onboarding\/configurar-atendimento/, { timeout: 20_000 });
    await snap(page, "j1.6-configurar-atendimento");
  });

  test("configurador coleta fatos, exige revisão e preserva limites no rascunho", async ({
    page,
  }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/configurar-atendimento/);
    const answers: Record<string, string> = {
      nome_do_negocio: "Loja QA VPS",
      descricao_do_negocio: "Instalação e manutenção de ar-condicionado residencial",
      regiao_atendida: "São Paulo",
      horario_de_atendimento: "Segunda a sexta, das 8h às 18h",
      servicos: "Instalação; manutenção",
      qualificacao: "Nome; bairro; tipo de equipamento",
      passagem_para_humano: "Risco elétrico; pedido de uma pessoa",
      resumo_para_humano: "Nome; serviço solicitado; bairro",
      temas_proibidos: "Não inventar preços; não fechar diagnóstico técnico",
      tom_de_voz: "Objetivo e cordial",
      perguntas_frequentes: "Atende aos sábados? => Não, somente segunda a sexta.",
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
    const state = (await orgRow()).onboarding_state as {
      configurador_atendimento?: {
        session: {
          status: string;
          spec: { business: { name: string }; forbidden_topics: string[] };
        };
      };
    };
    expect(state.configurador_atendimento?.session.status).toBe("revisado");
    expect(state.configurador_atendimento?.session.spec.business.name).toBe("Loja QA VPS");
    expect(state.configurador_atendimento?.session.spec.forbidden_topics).toContain(
      "Não inventar preços",
    );
  });

  test("J1.7 treinamento sem chave salva uma versão inerte com os fatos aprovados", async ({
    page,
  }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/setup-ai/);
    await page.locator("#name").fill("Tomik QA");
    await page.getByRole("button", { name: /criar e continuar/i }).click();
    await page.waitForURL(/\/onboarding\/funil/, { timeout: 20_000 });
    const org = await orgRow();
    const { data: agents, error: agentsError } = await svc
      .from("ai_agents")
      .select("id,name,is_active,is_default,published_version_id")
      .eq("organization_id", org.id);
    expect(agentsError).toBeNull();
    expect(agents).toHaveLength(1);
    expect(agents?.[0]).toMatchObject({
      name: "Tomik QA",
      is_default: true,
      published_version_id: null,
    });
    const { data: versions, error: versionsError } = await svc
      .from("ai_agent_versions")
      .select("id,status,credential_id,system_prompt,provisioning_origin,followup")
      .eq("organization_id", org.id)
      .eq("agent_id", agents![0]!.id);
    expect(versionsError).toBeNull();
    expect(versions).toHaveLength(1);
    expect(versions?.[0]).toMatchObject({
      status: "draft",
      credential_id: null,
      provisioning_origin: "onboarding",
    });
    expect(versions?.[0]?.system_prompt).toContain("Não inventar preços");
    expect(versions?.[0]?.system_prompt).toContain("São Paulo");
    expect((versions?.[0]?.followup as { enabled?: boolean })?.enabled).toBe(false);
    expect((org.onboarding_state as { teste?: { respondeu?: boolean } }).teste?.respondeu).toBe(
      false,
    );
    await snap(page, "j1.7-rascunho-inerte");
  });

  test("J1.26 onde ele organiza: sem funcionário no ar, oferece um quadro pronto e deixa seguir", async ({
    page,
  }) => {
    // Numa instalação sem chave de IA o agente ficou rascunho (J1.7), então a
    // sugestão de quadro, que sai do MESMO modelo que vai atender, não tem a
    // quem pedir. O passo não pode virar beco: diz o porquê, começa de um
    // modelo pronto e deixa seguir.
    await login(page);
    await page.waitForURL(/\/onboarding\/funil/, { timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: /onde ele organiza seus clientes/i }),
    ).toBeVisible();
    await expect(page.getByText(/ainda não está no ar/i)).toBeVisible();
    await expect(page.getByText(/isso não trava nada/i)).toBeVisible();

    // O que a tela mostra é o que tem de ser gravado: lido da própria tela, não
    // de uma lista fixa, para o caso valer com qualquer modelo pronto.
    const nomeDoQuadro = await page.getByLabel("Nome do quadro").inputValue();
    const colunas = await page
      .getByLabel(/^Nome da coluna \d+$/)
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(nomeDoQuadro.trim()).not.toBe("");
    expect(colunas.length).toBeGreaterThan(0);
    await snap(page, "j1.26-funil-sem-ia");

    await page.getByRole("button", { name: /usar este quadro/i }).click();
    await page.waitForURL(/\/onboarding\/testar/, { timeout: 20_000 });

    const org = await orgRow();
    const funil = (org.onboarding_state as { funil?: { pipeline_id?: string } } | null)?.funil;
    expect(funil?.pipeline_id, "o passo do quadro ficou registrado").toBeTruthy();
    const { data: pipeline } = await svc
      .from("crm_pipelines")
      .select("name")
      .eq("organization_id", org.id)
      .eq("id", funil?.pipeline_id ?? "")
      .maybeSingle();
    expect(pipeline?.name).toBe(nomeDoQuadro.trim());
    const { data: etapas } = await svc
      .from("crm_stages")
      .select("name")
      .eq("organization_id", org.id)
      .eq("pipeline_id", funil?.pipeline_id ?? "");
    for (const coluna of colunas) {
      expect(
        etapas?.map((e) => e.name),
        `a coluna "${coluna}" da tela foi gravada`,
      ).toContain(coluna.trim());
    }
  });

  test("J1.24 ensaio exige recibo real antes da ativação explícita do dono", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/testar/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /veja ele atender/i })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("ensaio do rascunho");
    const org = await orgRow();
    const countMessages = async () => {
      const { count, error } = await svc
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", org.id);
      expect(error).toBeNull();
      expect(typeof count).toBe("number");
      return count;
    };
    const before = await countMessages();
    await page.getByRole("button", { name: /^continuar$/i }).click();
    await expect(page.getByText("Faça um ensaio com resposta antes de continuar.")).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding\/testar/);

    const reply = page.waitForResponse(
      (res) =>
        /\/versions\/[^/]+\/test$/.test(new URL(res.url()).pathname) &&
        res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Mandar mensagem", exact: true }).click();
    const response = await reply;
    expect(response.ok()).toBe(true);
    const { data: result } = await response.json();
    expect(result.stub).toBe(true);
    expect(result.status).toBe("ok");
    expect(result.final_text.trim()).not.toBe("");
    expect(result.run_id).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(page.getByText(result.final_text, { exact: true })).toBeVisible();
    const { data: run, error: runError } = await svc
      .from("ai_agent_runs")
      .select("id,agent_id,agent_version_id,status,is_dry_run,completed_at")
      .eq("organization_id", org.id)
      .eq("id", result.run_id)
      .single();
    expect(runError).toBeNull();
    expect(run).toMatchObject({ status: "completed", is_dry_run: true });
    expect(run?.completed_at).toBeTruthy();
    expect(await countMessages()).toBe(before);
    await page.getByRole("button", { name: /^continuar$/i }).click();
    await page.waitForURL(/\/onboarding\/ativar/, { timeout: 20_000 });
    const state = (await orgRow()).onboarding_state as {
      teste?: { respondeu: boolean; run_id: string; version_id: string };
      ativacao?: unknown;
    };
    expect(state.teste).toMatchObject({
      respondeu: true,
      run_id: run!.id,
      version_id: run!.agent_version_id,
    });
    expect(state.ativacao).toBeUndefined();
    const activation = page.getByRole("button", { name: "Ativar agente agora", exact: true });
    await expect(activation).toBeEnabled();
    // Real publication validation still rejects the installation without a key.
    await activation.click();
    await expect(page.getByRole("alert")).toContainText("Não foi possível ativar");
    expect(
      (
        await svc
          .from("ai_agents")
          .select("published_version_id")
          .eq("organization_id", org.id)
          .eq("id", run!.agent_id)
          .single()
      ).data?.published_version_id,
    ).toBeNull();

    // Controlled transport/provider fixture, only in the guarded ephemeral runtime.
    // No paired number, no external provider key, no worker or outbound delivery.
    const { data: version, error: versionError } = await svc
      .from("ai_agent_versions")
      .select("provider,channel_session_id")
      .eq("organization_id", org.id)
      .eq("id", run!.agent_version_id)
      .single();
    expect(versionError).toBeNull();
    const { data: credential, error: credentialError } = await svc
      .from("ai_provider_credentials")
      .insert({
        organization_id: org.id,
        provider: version!.provider,
        label: "Sandbox de ativação QA",
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
    expect(
      (
        await svc
          .from("ai_agent_versions")
          .update({ credential_id: credential!.id })
          .eq("organization_id", org.id)
          .eq("id", run!.agent_version_id)
      ).error,
    ).toBeNull();
    expect(
      (
        await svc
          .from("channel_sessions")
          .update({
            status: "WORKING",
            metadata: { ai_gate: "allowlist", ai_test_phone_numbers: [] },
          })
          .eq("organization_id", org.id)
          .eq("id", version!.channel_session_id)
      ).error,
    ).toBeNull();
    await activation.click();
    await page.waitForURL(/\/onboarding\/invite-team/, { timeout: 20_000 });
    expect(
      (
        await svc
          .from("ai_agents")
          .select("published_version_id")
          .eq("organization_id", org.id)
          .eq("id", run!.agent_id)
          .single()
      ).data?.published_version_id,
    ).toBe(run!.agent_version_id);
    expect(
      ((await orgRow()).onboarding_state as { ativacao?: { version_id: string } }).ativacao
        ?.version_id,
    ).toBe(run!.agent_version_id);
    expect(await countMessages()).toBe(before);
    await snap(page, "j1.24-ativacao-com-recibo");
  });

  test("J1.8 convite SEM Resend: a UI não pode mentir que enviou email", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/invite-team/);

    await page.locator("#emails").fill("atendente@qa.local");
    await page.getByRole("button", { name: /enviar convites/i }).click();

    // Honestidade: sem RESEND_API_KEY nenhum email sai. A UI deve dizer isso
    // e oferecer o link de aceite copiável (nunca redirecionar em silêncio).
    //
    // A frase que este caso procurava ("não está configurado neste servidor")
    // não existe mais no produto — `git grep` devolve zero. O texto de hoje é
    // o do bloco âmbar de `app/onboarding/invite-team/_form.tsx:109`, e a tela
    // ainda diz a verdade: medido no job 105816595263 (parte 4), ela mostra
    // "Esta instalação não envia e-mail" com o link e o botão de copiar.
    await expect(page.getByText(/não envia e-mail/i).first()).toBeVisible({
      timeout: 15_000,
    });
    // O nome deste caso é "a UI não pode MENTIR que enviou": o controle
    // negativo é o que o torna verdade, e ele faltava. Nenhuma frase de envio
    // bem-sucedido pode aparecer numa instalação sem serviço de e-mail.
    await expect(page.getByText(/convites? enviad/i)).toHaveCount(0);
    // E a pessoa convidada aparece nominalmente ao lado do link dela, senão
    // "copie o link" não diz de quem é o link.
    await expect(page.getByText("atendente@qa.local").first()).toBeVisible();
    const acceptUrl = (
      await page
        .locator("code", { hasText: /team\/accept-invite/ })
        .first()
        .innerText()
    ).trim();
    expect(acceptUrl).toMatch(/\/team\/accept-invite\/.+/);
    fs.writeFileSync(
      path.join(process.cwd(), ".e2e-invite-url.json"),
      JSON.stringify({ email: "atendente@qa.local", accept_url: acceptUrl }, null, 2),
    );
    await snap(page, "j1.8-convite-sem-resend");

    // e o wizard segue em frente conscientemente
    await page.getByRole("button", { name: /^continuar$/i }).click();
    await page.waitForURL(/\/onboarding\/done/, { timeout: 20_000 });
  });

  test("J1.9 done → onboarded_at setado e cai no inbox", async ({ page }) => {
    await login(page);
    await page.waitForURL(/\/onboarding\/done/);
    await snap(page, "j1.9-done-recap");

    await page.getByRole("button", { name: /começar a usar/i }).click();
    await page.waitForURL(/\/app\/inbox/, { timeout: 30_000 });

    const org = await orgRow();
    expect(org.onboarded_at).not.toBeNull();
  });

  test("J1.10 verificação em duas etapas: ativa pela tela e VÊ os códigos de recuperação", async ({
    page,
  }) => {
    await login(page);
    await page.waitForURL(/\/app\//, { timeout: 30_000 });

    // ⚠️ ESTE CASO MUDOU DE PORTA, e a mudança é o ponto. Ele testava o
    // BLOQUEADOR não-dismissível que aparecia sozinho para todo admin — e era
    // exatamente o que fazia a instalação fresca receber um sétimo passo logo
    // depois do wizard, sem aviso. A verificação virou opcional; o cadastro
    // agora começa em Configurações › Segurança, por escolha de quem entra.
    //
    // O que este caso continua guardando é o que importava nele: o fluxo de
    // enroll leva até os CÓDIGOS DE RECUPERAÇÃO (a regressão que o nome antigo
    // citava). Perder isso seria trocar uma tela por nenhuma.
    await page.goto("/app/settings/security");
    await expect(page.getByText("Desativada")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /^ativar$/i }).click();

    // O título do DIÁLOGO, e não "o texto aparece em algum lugar": a página de
    // Segurança tem a seção "Verificação em duas etapas" e o diálogo tem
    // "Configure a verificação em duas etapas". Medido no run da parte 4 (job
    // 105825863584): o `getByRole('heading', /verificação em duas etapas/i)`
    // casava os DOIS e o strict mode reprovava — os dois certos, a sonda é que
    // não dizia qual. Prender no `#mfa-title` é o que prova que o diálogo ABRIU.
    await expect(page.locator("#mfa-title")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#mfa-title")).toHaveText(/verificação em duas etapas/i);
    await snap(page, "j1.10-mfa-ativar");

    await page.getByRole("button", { name: /iniciar configuração/i }).click();
    await expect(page.locator('img[alt="QR code para configurar autenticador"]')).toBeVisible({
      timeout: 20_000,
    });

    // secret manual (o que um leigo digitaria no app autenticador)
    await page.getByText(/não consegue escanear/i).click();
    const secret = (await page.locator("code").innerText()).trim();
    expect(secret.length).toBeGreaterThan(15);
    fs.writeFileSync(
      OWNER_STATE_PATH,
      JSON.stringify(
        { email: OWNER_EMAIL, password: OWNER_PASSWORD, totp_secret: secret },
        null,
        2,
      ),
    );

    // digita o código com retry na virada da janela TOTP
    for (let attempt = 0; attempt < 3; attempt++) {
      if (msUntilNextTotpWindow() < 4_000) await page.waitForTimeout(msUntilNextTotpWindow() + 300);
      await page.locator('input[aria-label="Dígito 1"]').click();
      await page.keyboard.type(generateTotp(secret), { delay: 40 });
      try {
        // MESMA ARMADILHA DO FECHO, e aqui ela desligava o retry: a página de
        // Segurança tem a seção "Códigos de recuperação" impressa desde antes
        // do enroll (`_client.tsx:176`, fora de condicional), então
        // `getByRole('heading', /códigos de recuperação/i)` já valia ANTES de
        // o modal chegar ao passo dos códigos — e passava na hora, mesmo com o
        // TOTP recusado. Medido: com os dois títulos no DOM o strict mode
        // reprova (`resolved to 2 elements`), então o verde só podia vir do
        // casamento único, o da página. Resultado: este `for` nunca dava a
        // segunda volta e a virada da janela TOTP caía lá embaixo, como falha
        // confusa. `#mfa-title` é o título do passo ATUAL do modal (intro,
        // scan e codes são ramos exclusivos), então prendê-lo aqui é o que
        // pergunta de fato "o modal avançou?".
        await expect(page.locator("#mfa-title")).toHaveText(/códigos de recuperação/i, {
          timeout: 8_000,
        });
        break;
      } catch {
        if (attempt === 2) throw new Error("MFA enroll não chegou aos recovery codes");
        // código recusado (janela virou) → limpa e tenta de novo
        await page.locator('input[aria-label="Dígito 1"]').click();
        for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
      }
    }

    // O BUG: a revalidação do server action desmontava o gate e o usuário
    // caía no inbox sem ver estes códigos. Prova de que a tela persiste com os
    // 10 códigos + ações de salvar (grid font-mono no RecoveryCodesPanel).
    await expect(page.getByText(/salve esses 10 códigos/i)).toBeVisible();
    const codes = page.locator("div.font-mono");
    await expect(codes).toHaveCount(10);
    await expect(page.getByRole("button", { name: /copiar todos/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /baixar \.txt/i })).toBeVisible();
    await snap(page, "j1.10-recovery-codes");

    await page.getByText(/salvei meus códigos/i).click();
    await page.getByRole("button", { name: /^concluir$/i }).click();

    // ⚠️ SEGUNDA HERANÇA DA MESMA MUDANÇA DE PORTA. Cobrar que o título
    // "Verificação em duas etapas" SUMA valia quando o cadastro vinha do
    // bloqueador de tela cheia e terminar caía no inbox — daí o nome
    // `j1.10-inbox-livre`. Hoje o fluxo começa e termina em Configurações ›
    // Segurança, e essa página imprime a seção "Verificação em duas etapas"
    // o tempo todo (`app/app/settings/security/_client.tsx:78`, fora de
    // qualquer condicional). Medido no job 105829755207: `44 × locator
    // resolved to 1 element` — o único casamento era essa seção, com o
    // diálogo já fechado e o selo em "Ativada". O vermelho media a mudança de
    // porta, não regressão.
    //
    // O que prova o fim do fluxo HOJE são duas coisas, e a segunda é a que
    // não deixa o caso passar por acidente:
    await page.waitForLoadState("networkidle");
    // 1) o DIÁLOGO fechou — `#mfa-title` é o título dos três passos do modal
    //    (intro, QR, códigos), então count 0 é o modal inteiro desmontado;
    await expect(page.locator("#mfa-title")).toHaveCount(0, { timeout: 20_000 });
    // 2) CONTROLE NEGATIVO — o estado MUDOU no servidor. Se o enroll não
    //    persistisse, ou se "Concluir" desfizesse o cadastro, a página
    //    recarregada voltaria exatamente ao estado em que este caso COMEÇOU
    //    (selo "Desativada" + botão "Ativar") e o modal também estaria
    //    fechado — ou seja, só a asserção (1) passaria feliz. Esta reprova.
    await expect(page.getByText("Ativada", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^desligar$/i })).toBeVisible();
    await expect(page.getByText("Desativada", { exact: true })).toHaveCount(0);
    // e a pessoa não ficou presa: o shell do app respondeu ao reload (se a
    // sessão tivesse caído no enroll, aqui seria a tela de login).
    await expect(page.getByRole("link", { name: "Inbox", exact: true })).toBeVisible();
    await snap(page, "j1.10-verificacao-ativada");
  });

  test("J1.13 wizard não reabre depois de concluído", async ({ page }) => {
    // agora o login do dono exige TOTP
    const state = JSON.parse(fs.readFileSync(OWNER_STATE_PATH, "utf8")) as { totp_secret: string };
    await login(page);
    await page.waitForURL(/\/login\/mfa/, { timeout: 20_000 });
    if (msUntilNextTotpWindow() < 4_000) await page.waitForTimeout(msUntilNextTotpWindow() + 300);
    await page.locator('input[aria-label="Dígito 1"]').click();
    await page.keyboard.type(generateTotp(state.totp_secret), { delay: 40 });
    await page.waitForURL(/\/app\//, { timeout: 30_000 });

    await page.goto("/onboarding");
    await page.waitForURL(/\/app\/inbox/, { timeout: 15_000 });
  });
});
