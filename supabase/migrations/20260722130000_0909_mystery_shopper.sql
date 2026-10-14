-- 0036_mystery_shopper — módulo "Cliente/Paciente Oculto" (auditoria de
-- atendimento). A IA vira o CLIENTE: conversa com o WhatsApp de uma empresa-alvo
-- posando de humano, conduz até a oferta de horário (NÃO fecha agendamento real)
-- e gera um laudo enviado a um número cadastrado.
--
-- Fundação (Fase 1): distingue o número do oculto do número de atendimento e
-- cria as tabelas de campanha/mensagens ISOLADAS de conversations/messages (pra
-- não poluir o inbox nem acionar o bot-da-empresa). Aditivo e idempotente.

-- 1) Propósito do canal: 'inbound' (atendimento normal) vs 'mystery_shopper'
--    (número do oculto — inbound NÃO deve disparar o dispatcher do bot).
alter table public.channel_sessions
  add column if not exists purpose text not null default 'inbound';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'channel_sessions_purpose_check') then
    alter table public.channel_sessions
      add constraint channel_sessions_purpose_check check (purpose in ('inbound', 'mystery_shopper'));
  end if;
end $$;

-- 2) Campanhas de auditoria.
create table if not exists public.mystery_shopper_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shopper_session_id uuid not null references public.channel_sessions(id) on delete restrict,
  target_number text not null,
  target_name text,
  persona jsonb not null default '{}'::jsonb,
  recipient_number text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'stalled', 'failed', 'cancelled')),
  outcome text,
  started_at timestamptz not null default now(),
  first_contact_at timestamptz,
  slot_offered_at timestamptz,
  ended_at timestamptz,
  message_count int not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  report_storage_path text,
  transcript_storage_path text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mystery_campaigns_org_status_idx
  on public.mystery_shopper_campaigns (organization_id, status, started_at desc);
-- Uma campanha ATIVA por sessão de oculto (manual, 1 alvo por vez).
create unique index if not exists uniq_mystery_active_per_session
  on public.mystery_shopper_campaigns (shopper_session_id) where status = 'running';

alter table public.mystery_shopper_campaigns enable row level security;
drop policy if exists tenant_isolation_mystery_campaigns_all on public.mystery_shopper_campaigns;
create policy tenant_isolation_mystery_campaigns_all on public.mystery_shopper_campaigns
  for all using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));
grant all on table public.mystery_shopper_campaigns to service_role;
grant select, insert, update, delete on table public.mystery_shopper_campaigns to authenticated;

-- 3) Mensagens da conversa do oculto (isoladas do inbox).
create table if not exists public.mystery_shopper_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.mystery_shopper_campaigns(id) on delete cascade,
  direction text not null check (direction in ('shopper', 'target')),
  body text,
  external_id text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (campaign_id, external_id)
);
create index if not exists mystery_messages_campaign_idx
  on public.mystery_shopper_messages (campaign_id, sent_at);

alter table public.mystery_shopper_messages enable row level security;
drop policy if exists tenant_isolation_mystery_messages_all on public.mystery_shopper_messages;
create policy tenant_isolation_mystery_messages_all on public.mystery_shopper_messages
  for all using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));
grant all on table public.mystery_shopper_messages to service_role;
grant select, insert, update, delete on table public.mystery_shopper_messages to authenticated;
