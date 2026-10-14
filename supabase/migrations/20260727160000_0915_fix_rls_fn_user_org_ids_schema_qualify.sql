-- 0042 — Forward-fix: policies de RLS chamavam fn_user_org_ids() SEM schema.
--
-- No apêndice do baseline.sql (dump com search_path vazio), 6 tabelas criavam a
-- policy `tenant_isolation_*` usando `select fn_user_org_ids()` sem o prefixo
-- `public.`. No `install.sh`/`update.sh` (que rodam o baseline com search_path
-- vazio) o CREATE POLICY falha com "function fn_user_org_ids() does not exist" —
-- então a tabela fica com RLS LIGADO e ZERO policies = nega tudo (fail-closed).
-- Efeito: usuário autenticado não enxerga os próprios dados (funil do Cliente
-- Oculto vazio, settings de followup/tags/notificações vazias).
--
-- Correção: recriar todas as policies afetadas qualificando `public.fn_user_org_ids()`.
-- Idempotente (drop if exists + create) e auto-curativa. Ver baseline.sql (16 usos
-- corrigidos) + MANIFEST.

-- calendar_integrations
drop policy if exists tenant_isolation_calendar_integrations_select on public.calendar_integrations;
create policy tenant_isolation_calendar_integrations_select on public.calendar_integrations for select
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_calendar_integrations_modify on public.calendar_integrations;
create policy tenant_isolation_calendar_integrations_modify on public.calendar_integrations
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- followup_settings
drop policy if exists tenant_isolation_followup_settings_select on public.followup_settings;
create policy tenant_isolation_followup_settings_select on public.followup_settings for select
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_followup_settings_modify on public.followup_settings;
create policy tenant_isolation_followup_settings_modify on public.followup_settings
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- tag_definitions
drop policy if exists tenant_isolation_tag_definitions_select on public.tag_definitions;
create policy tenant_isolation_tag_definitions_select on public.tag_definitions for select
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_tag_definitions_modify on public.tag_definitions;
create policy tenant_isolation_tag_definitions_modify on public.tag_definitions
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- notification_settings
drop policy if exists tenant_isolation_notification_settings_select on public.notification_settings;
create policy tenant_isolation_notification_settings_select on public.notification_settings for select
  using (organization_id in (select public.fn_user_org_ids()));
drop policy if exists tenant_isolation_notification_settings_modify on public.notification_settings;
create policy tenant_isolation_notification_settings_modify on public.notification_settings
  using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- mystery_shopper_campaigns
drop policy if exists tenant_isolation_mystery_campaigns_all on public.mystery_shopper_campaigns;
create policy tenant_isolation_mystery_campaigns_all on public.mystery_shopper_campaigns
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- mystery_shopper_messages
drop policy if exists tenant_isolation_mystery_messages_all on public.mystery_shopper_messages;
create policy tenant_isolation_mystery_messages_all on public.mystery_shopper_messages
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));
