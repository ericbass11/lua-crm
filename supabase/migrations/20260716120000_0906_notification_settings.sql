-- =============================================================================
-- 0033_notification_settings
-- Alerta ao time quando a IA faz handoff (passa a conversa para humano).
-- Webhook genérico por org (Slack/Discord/n8n/custom) — o handoff-orchestrator
-- faz POST fire-and-forget. Sem isto, handoffs ficam parados sem ninguém saber.
-- Idempotente.
-- =============================================================================
create table if not exists public.notification_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  handoff_webhook_url text,
  handoff_enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
drop policy if exists tenant_isolation_notification_settings_select on public.notification_settings;
create policy tenant_isolation_notification_settings_select
  on public.notification_settings for select using (organization_id in (select fn_user_org_ids()));
drop policy if exists tenant_isolation_notification_settings_modify on public.notification_settings;
create policy tenant_isolation_notification_settings_modify
  on public.notification_settings using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));
grant all on table public.notification_settings to service_role;
grant select, insert, update, delete on table public.notification_settings to authenticated;
