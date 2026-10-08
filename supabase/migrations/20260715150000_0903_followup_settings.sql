-- =============================================================================
-- 0030_followup_settings
-- Follow-up automático personalizado por IA (sequência por inatividade).
--
-- `followup_settings` (1 linha por org): liga/desliga, sequência de etapas
-- (delay + instrução de tom por etapa), janela de envio (anti-banimento:
-- doutrina 7h-22h, evitar domingo) e fuso.
--
-- Estado do ciclo NÃO é persistido: o passo atual é derivado das mensagens —
-- count(outbound com metadata.followup_step) desde last_inbound_at. Cliente
-- respondeu → last_inbound_at avança → contagem zera → ciclo reinicia sozinho.
--
-- `ai_agent_runs` ganha is_followup/followup_step/followup_hint: o cron
-- followup-dispatcher cria runs sem inbound novo (inbound_message_id null) e
-- o runtime usa followup_hint como instrução interna no lugar da mensagem.
--
-- Idempotente.
-- =============================================================================

create table if not exists public.followup_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  timezone text not null default 'America/Sao_Paulo',
  -- dias 0=dom..6=sáb; janela de envio no fuso acima
  send_window jsonb not null default '{"days":[1,2,3,4,5,6],"start":"08:00","end":"21:00"}'::jsonb,
  -- etapas: delay_minutes conta a partir da ÚLTIMA mensagem da conversa
  steps jsonb not null default '[
    {"delay_minutes": 15,   "hint": "Retome a última pergunta de forma leve e natural."},
    {"delay_minutes": 120,  "hint": "Agregue valor: uma dica útil e específica ligada ao que foi conversado."},
    {"delay_minutes": 1440, "hint": "Última tentativa: cordial e breve, deixe a porta aberta sem pressionar."}
  ]'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.followup_settings enable row level security;

drop policy if exists tenant_isolation_followup_settings_select on public.followup_settings;
create policy tenant_isolation_followup_settings_select
  on public.followup_settings for select
  using (organization_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_followup_settings_modify on public.followup_settings;
create policy tenant_isolation_followup_settings_modify
  on public.followup_settings
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

grant all on table public.followup_settings to service_role;
grant select, insert, update, delete on table public.followup_settings to authenticated;

alter table public.ai_agent_runs
  add column if not exists is_followup boolean not null default false;
alter table public.ai_agent_runs
  add column if not exists followup_step integer;
alter table public.ai_agent_runs
  add column if not exists followup_hint text;
