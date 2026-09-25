-- 0040_mystery_crm — CRM de prospecção do Cliente Oculto: cada empresa auditada
-- vira um lead pra vender o Agente de IA da Lua CRM. Estende a campanha com a
-- etapa do funil, localização (cidade/UF), notas e a ANÁLISE do laudo
-- estruturada em JSONB (base do RAG/insights). Aditivo/idempotente.

alter table public.mystery_shopper_campaigns
  add column if not exists stage text,
  add column if not exists stage_changed_at timestamptz,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists notes text,
  add column if not exists analysis jsonb;

-- Funil: null enquanto a auditoria roda; entra em 'auditado' quando conclui.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mystery_campaigns_stage_check') then
    alter table public.mystery_shopper_campaigns
      add constraint mystery_campaigns_stage_check
      check (stage is null or stage in
        ('auditado','qualificado','contato','proposta','negociacao','fechado','perdido'));
  end if;
end $$;

create index if not exists mystery_campaigns_stage_idx
  on public.mystery_shopper_campaigns (organization_id, stage) where stage is not null;
