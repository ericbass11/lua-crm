-- =============================================================================
-- 0029_calendar_integrations
-- Integração de agenda (Google Calendar via Service Account) por tenant.
--
-- A chave JSON da Service Account é cifrada AES-256-GCM (mesma AI_CRED_AES_KEY
-- e helpers lib/crypto/aes_gcm.ts usados por ai_provider_credentials). A view
-- *_safe nunca expõe os campos cifrados — o front lê apenas dela.
--
-- Consumidores:
--   * rotas /api/v1/integrations/calendar (CRUD, admin)
--   * tools MCP crm_check_availability / crm_schedule_meeting (runtime agentes)
--
-- Idempotente (if not exists / or replace) — re-aplicável em qualquer clone.
-- =============================================================================

create table if not exists public.calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'google',
  label text not null default 'Agenda principal',
  -- ID da agenda no Google ('primary' ou o e-mail da agenda compartilhada)
  calendar_id text not null default 'primary',
  -- client_email da Service Account (exposto na view: o admin precisa dele
  -- para compartilhar a agenda com o robô)
  service_account_email text not null,
  sa_key_encrypted bytea not null,
  sa_key_iv bytea not null,
  sa_key_tag bytea not null,
  timezone text not null default 'America/Sao_Paulo',
  slot_minutes integer not null default 30,
  -- Janela de atendimento única aplicada aos dias habilitados.
  -- days: 0=domingo ... 6=sábado (getDay do JS)
  business_hours jsonb not null default '{"days":[1,2,3,4,5],"start":"09:00","end":"18:00"}'::jsonb,
  is_active boolean not null default true,
  validated_at timestamptz,
  validation_error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_integrations_provider_check check (provider in ('google')),
  constraint calendar_integrations_slot_check check (slot_minutes between 10 and 240),
  constraint calendar_integrations_label_unique unique (organization_id, provider, label)
);

create index if not exists calendar_integrations_org_idx
  on public.calendar_integrations (organization_id);

alter table public.calendar_integrations enable row level security;

drop policy if exists tenant_isolation_calendar_integrations_select on public.calendar_integrations;
create policy tenant_isolation_calendar_integrations_select
  on public.calendar_integrations for select
  using (organization_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_calendar_integrations_modify on public.calendar_integrations;
create policy tenant_isolation_calendar_integrations_modify
  on public.calendar_integrations
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

-- View segura: nunca expõe os bytea cifrados.
create or replace view public.calendar_integrations_safe
  with (security_invoker = 'true') as
select id, organization_id, provider, label, calendar_id, service_account_email,
       timezone, slot_minutes, business_hours, is_active,
       validated_at, validation_error, created_by, created_at, updated_at
  from public.calendar_integrations;

grant all on table public.calendar_integrations to service_role;
grant select, insert, update, delete on table public.calendar_integrations to authenticated;
grant all on table public.calendar_integrations_safe to service_role;
grant select on table public.calendar_integrations_safe to authenticated;
