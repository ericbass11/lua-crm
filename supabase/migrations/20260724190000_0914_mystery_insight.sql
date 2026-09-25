-- 0041_mystery_insight — insight de venda por empresa auditada (Fase 3).
-- Texto gerado por LLM a partir do laudo real (métricas + problemas) para o
-- vendedor usar ao abordar a empresa com o Agente de IA da Lua CRM. Aditivo.
alter table public.mystery_shopper_campaigns
  add column if not exists insight text,
  add column if not exists insight_at timestamptz;
