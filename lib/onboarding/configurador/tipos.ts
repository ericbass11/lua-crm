import { z } from "zod";

export const NICHO_CLIMATIZACAO = "climatizacao_residencial_pequeno_comercio" as const;

export const agentSpecSchemaV1 = z
  .object({
    schema_version: z.literal(1),
    niche: z.literal(NICHO_CLIMATIZACAO),
    business: z
      .object({
        name: z.string().trim().min(1).optional(),
        description: z.string().trim().min(1).optional(),
        service_area: z.string().trim().min(1).optional(),
        opening_hours: z.string().trim().min(1).optional(),
      })
      .strict(),
    services: z.array(z.string().trim().min(1)),
    qualification: z.array(z.string().trim().min(1)),
    handoff: z
      .object({
        triggers: z.array(z.string().trim().min(1)),
        summary_fields: z.array(z.string().trim().min(1)),
      })
      .strict(),
    forbidden_topics: z.array(z.string().trim().min(1)),
    tone: z.string().trim().min(1).optional(),
    faq: z.array(
      z.object({ question: z.string().trim().min(1), answer: z.string().trim().min(1) }).strict(),
    ),
  })
  .strict();

export type AgentSpecV1 = z.infer<typeof agentSpecSchemaV1>;

export const perguntaIdSchema = z.enum([
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

export type PerguntaId = z.infer<typeof perguntaIdSchema>;

export interface PerguntaConfigurador {
  id: PerguntaId;
  texto: string;
}

export const perguntaConfiguradorSchema = z
  .object({ id: perguntaIdSchema, texto: z.string().trim().min(1).max(500) })
  .strict();

const respostasConfiguradorSchema = z
  .object(
    Object.fromEntries(
      perguntaIdSchema.options.map((id) => [id, z.string().min(1).max(3000).optional()]),
    ) as Record<PerguntaId, z.ZodOptional<z.ZodString>>,
  )
  .partial()
  .strict();

export const sessaoConfiguradorSchema = z
  .object({
    status: z.enum(["coletando", "pronto_para_revisao", "revisado"]),
    pergunta_atual: perguntaConfiguradorSchema.nullable(),
    respostas: respostasConfiguradorSchema,
    spec: agentSpecSchemaV1,
  })
  .strict();

export type SessaoConfigurador = z.infer<typeof sessaoConfiguradorSchema>;
