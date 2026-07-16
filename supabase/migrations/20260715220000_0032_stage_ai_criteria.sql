-- =============================================================================
-- 0032_stage_ai_criteria
-- Critério de IA por etapa do Kanban (gestão de funil pela IA — Fase 1).
--
-- `crm_stages.ai_criteria`: texto livre escrito pelo operador descrevendo
-- QUANDO um lead deve estar nesta etapa (ex.: "demonstrou interesse real no
-- produto: pediu orçamento, perguntou prazo ou quis falar com comercial").
-- O runtime injeta o funil (etapas + critérios + lead atual do contato) no
-- contexto do agente, que cria/move leads via tools crm_create_lead /
-- crm_move_lead_stage e preenche campos via crm_set_lead_fields.
--
-- Etapa sem ai_criteria = ignorada pela IA (gestão manual preservada).
-- Idempotente.
-- =============================================================================

alter table public.crm_stages
  add column if not exists ai_criteria text;
