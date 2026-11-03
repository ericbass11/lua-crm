"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { audit } from "@/lib/audit";
import {
  confirmarRevisao,
  iniciarConfigurador,
  responderPergunta,
  revisarResposta,
  type PerguntaId,
  type SessaoConfigurador,
} from "@/lib/onboarding/configurador";
import {
  loadOnboardingState,
  OnboardingError,
  patchOnboardingState,
  requireOnboardingCtx,
} from "./_shared";

type ConfiguradorResult =
  { ok: true } | { ok: false; error: "auth_required" | "forbidden" | "invalid_input" | "db_error" };

const respostaSchema = z.string().trim().min(1).max(3000);
const perguntaIdSchema = z.enum([
  "nome_do_negocio",
  "descricao_do_negocio",
  "regiao_atendida",
  "horario_de_atendimento",
  "servicos",
  "qualificacao",
  "passagem_para_humano",
  "resumo_para_humano",
  "temas_proibidos",
  "tom_de_voz",
  "perguntas_frequentes",
]);

async function contextoESessao(): Promise<{
  ctx: Awaited<ReturnType<typeof requireOnboardingCtx>>;
  session: SessaoConfigurador;
}> {
  const ctx = await requireOnboardingCtx();
  const { state } = await loadOnboardingState(ctx.orgId);
  return {
    ctx,
    session: state.configurador_atendimento?.session ?? iniciarConfigurador(),
  };
}

async function salvarSessao(orgId: string, session: SessaoConfigurador): Promise<void> {
  await patchOnboardingState(orgId, {
    configurador_atendimento: {
      session,
      updated_at: new Date().toISOString(),
      ...(session.status === "revisado" ? { approved_at: new Date().toISOString() } : {}),
    },
    // Mudar qualquer resposta invalida a prova de sandbox anterior. A ativação
    // exige recibo da versão exata, e nunca pode herdar um teste de outra spec.
    ...(session.status === "revisado" ? {} : { teste: { respondeu: false } }),
  });
}

export async function responderConfigurador(formData: FormData): Promise<ConfiguradorResult> {
  let dados;
  try {
    dados = await contextoESessao();
  } catch (error) {
    if (error instanceof OnboardingError) {
      return {
        ok: false,
        error: error.code === "forbidden" ? "forbidden" : "auth_required",
      };
    }
    throw error;
  }

  const parsed = respostaSchema.safeParse(formData.get("resposta"));
  if (!parsed.success || dados.session.status !== "coletando") {
    return { ok: false, error: "invalid_input" };
  }

  const perguntaId = dados.session.pergunta_atual?.id;
  try {
    const session = responderPergunta(dados.session, parsed.data);
    await salvarSessao(dados.ctx.orgId, session);
    await audit({
      action: "onboarding.agent_setup_answered",
      actorUserId: dados.ctx.userId,
      organizationId: dados.ctx.orgId,
      resourceType: "organization",
      resourceId: dados.ctx.orgId,
      metadata: { field: perguntaId },
    });
  } catch (error) {
    if (error instanceof OnboardingError) return { ok: false, error: "db_error" };
    throw error;
  }

  redirect("/onboarding");
}

export async function revisarConfigurador(formData: FormData): Promise<ConfiguradorResult> {
  let dados;
  try {
    dados = await contextoESessao();
  } catch (error) {
    if (error instanceof OnboardingError) return { ok: false, error: "auth_required" };
    throw error;
  }

  const id = perguntaIdSchema.safeParse(formData.get("pergunta_id"));
  const resposta = respostaSchema.safeParse(formData.get("resposta"));
  if (!id.success || !resposta.success) return { ok: false, error: "invalid_input" };

  try {
    await salvarSessao(
      dados.ctx.orgId,
      revisarResposta(dados.session, id.data as PerguntaId, resposta.data),
    );
  } catch (error) {
    if (error instanceof OnboardingError) return { ok: false, error: "db_error" };
    return { ok: false, error: "invalid_input" };
  }

  redirect("/onboarding");
}

export async function aprovarConfigurador(): Promise<ConfiguradorResult> {
  let dados;
  try {
    dados = await contextoESessao();
    const session = confirmarRevisao(dados.session);
    await salvarSessao(dados.ctx.orgId, session);
    await audit({
      action: "onboarding.agent_setup_approved",
      actorUserId: dados.ctx.userId,
      organizationId: dados.ctx.orgId,
      resourceType: "organization",
      resourceId: dados.ctx.orgId,
      metadata: { schema_version: session.spec.schema_version, niche: session.spec.niche },
    });
  } catch (error) {
    if (error instanceof OnboardingError) return { ok: false, error: "db_error" };
    return { ok: false, error: "invalid_input" };
  }

  redirect("/onboarding");
}
