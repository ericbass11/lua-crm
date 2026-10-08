-- ============================================================================
-- 0918 — ENDURECIMENTO DAS TABELAS DESTA INSTALAÇÃO (fork LUA CRM)
--
-- Achado pela sincronização com o upstream v1.16.1 (2026-09-08), quando três
-- invariantes que ele apertou reprovaram as seis tabelas que só existem aqui:
--
--   calendar_integrations, followup_settings, notification_settings,
--   tag_definitions, mystery_shopper_campaigns, mystery_shopper_messages
--
-- ## Os três defeitos, medidos no banco
--
-- 1. **Policy `ALL` só-tenancy.** Cada tabela tinha uma policy `for all` cujo
--    único predicado era "é membro da organização". Um `viewer` — papel que
--    existe para SÓ OLHAR — apagava tag, trocava a configuração de follow-up
--    ou a URL do webhook de handoff da própria organização falando direto com
--    o PostgREST, com o JWT dele. As rotas HTTP exigem `manager`/`admin`, mas
--    RLS é a última linha, e ela não perguntava o papel.
--    (`tests/invariants/rbac-config-ia-canais.test.ts`, "a dívida de RBAC não cresce")
--
-- 2. **Alcançáveis por `anon`.** As policies eram `to public` e o dump do
--    baseline concede `GRANT ALL` a `anon` em toda tabela. Na prática a RLS
--    devolvia zero linhas (auth.uid() nulo → fn_user_org_ids() vazio), mas a
--    tabela seguia ENDEREÇÁVEL pela anon key, que vai para o navegador —
--    superfície que não precisa existir.
--    (`tests/invariants/agenda-nenhuma-tabela-sem-rls.test.ts`, has_table_privilege('anon'))
--
-- 3. **`fn_audit_hash_chain()` executável por `authenticated`.** É SECURITY
--    DEFINER e escreve (é o trigger da cadeia de hash da auditoria). Quem
--    executa o trigger é o dono da função, e a permissão de EXECUTE é conferida
--    na CRIAÇÃO do trigger, não a cada disparo — então nenhum papel de sessão
--    precisa dela. Sem o revoke, qualquer usuário logado de qualquer tenant
--    podia chamá-la como RPC.
--    (`tests/invariants/hardening-definer-varredura.test.ts`)
--
-- ## Por que nada quebra
--
-- Toda escrita nessas tabelas passa por rota HTTP com `requireRole` (manager
-- ou admin) ou por server action com o client de service role — que bypassa
-- RLS. Nenhuma tela escreve nelas pelo navegador com o JWT do usuário. O que
-- muda é só o que já era indevido: escrita por papel baixo e endereçamento
-- pela anon key.
--
-- ## Forma
--
-- A MESMA forma das tabelas de config do upstream (`crm_pipelines_select` +
-- `crm_pipelines_manager_write`): SELECT para membro (ou platform admin),
-- escrita para `fn_role_at_least(organization_id, 'manager')`. Idempotente:
-- `drop policy if exists` antes de cada `create policy`; `revoke` já é.
--
-- Prova comportamental em `tests/invariants/fork-rls-isolation.test.ts`.
-- ============================================================================

-- ─── 1 · anon não endereça tabela de tenant ──────────────────────────────────
revoke all on table public.calendar_integrations       from anon;
revoke all on table public.calendar_integrations_safe  from anon;
revoke all on table public.followup_settings           from anon;
revoke all on table public.notification_settings       from anon;
revoke all on table public.tag_definitions             from anon;
revoke all on table public.mystery_shopper_campaigns   from anon;
revoke all on table public.mystery_shopper_messages    from anon;

-- ─── 2 · calendar_integrations ───────────────────────────────────────────────
drop policy if exists tenant_isolation_calendar_integrations_select on public.calendar_integrations;
drop policy if exists tenant_isolation_calendar_integrations_modify on public.calendar_integrations;
drop policy if exists calendar_integrations_select        on public.calendar_integrations;
drop policy if exists calendar_integrations_manager_write on public.calendar_integrations;
create policy calendar_integrations_select on public.calendar_integrations
  for select to authenticated using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
create policy calendar_integrations_manager_write on public.calendar_integrations
  for all to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- ─── 3 · followup_settings ───────────────────────────────────────────────────
drop policy if exists tenant_isolation_followup_settings_select on public.followup_settings;
drop policy if exists tenant_isolation_followup_settings_modify on public.followup_settings;
drop policy if exists followup_settings_select        on public.followup_settings;
drop policy if exists followup_settings_manager_write on public.followup_settings;
create policy followup_settings_select on public.followup_settings
  for select to authenticated using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
create policy followup_settings_manager_write on public.followup_settings
  for all to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- ─── 4 · notification_settings ───────────────────────────────────────────────
drop policy if exists tenant_isolation_notification_settings_select on public.notification_settings;
drop policy if exists tenant_isolation_notification_settings_modify on public.notification_settings;
drop policy if exists notification_settings_select        on public.notification_settings;
drop policy if exists notification_settings_manager_write on public.notification_settings;
create policy notification_settings_select on public.notification_settings
  for select to authenticated using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
create policy notification_settings_manager_write on public.notification_settings
  for all to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- ─── 5 · tag_definitions ─────────────────────────────────────────────────────
drop policy if exists tenant_isolation_tag_definitions_select on public.tag_definitions;
drop policy if exists tenant_isolation_tag_definitions_modify on public.tag_definitions;
drop policy if exists tag_definitions_select        on public.tag_definitions;
drop policy if exists tag_definitions_manager_write on public.tag_definitions;
create policy tag_definitions_select on public.tag_definitions
  for select to authenticated using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
create policy tag_definitions_manager_write on public.tag_definitions
  for all to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- ─── 6 · mystery_shopper_campaigns (Cliente Oculto) ──────────────────────────
-- O motor escreve com service role; a tela lê e move por server actions. A
-- escrita pelo JWT fica para manager+ — é o papel que opera o módulo.
drop policy if exists tenant_isolation_mystery_campaigns_all       on public.mystery_shopper_campaigns;
drop policy if exists mystery_shopper_campaigns_select             on public.mystery_shopper_campaigns;
drop policy if exists mystery_shopper_campaigns_manager_write      on public.mystery_shopper_campaigns;
create policy mystery_shopper_campaigns_select on public.mystery_shopper_campaigns
  for select to authenticated using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
create policy mystery_shopper_campaigns_manager_write on public.mystery_shopper_campaigns
  for all to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- ─── 7 · mystery_shopper_messages ────────────────────────────────────────────
drop policy if exists tenant_isolation_mystery_messages_all        on public.mystery_shopper_messages;
drop policy if exists mystery_shopper_messages_select              on public.mystery_shopper_messages;
drop policy if exists mystery_shopper_messages_manager_write       on public.mystery_shopper_messages;
create policy mystery_shopper_messages_select on public.mystery_shopper_messages
  for select to authenticated using (
    (organization_id in (select public.fn_user_org_ids())) or public.fn_is_platform_admin()
  );
create policy mystery_shopper_messages_manager_write on public.mystery_shopper_messages
  for all to authenticated
  using (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  )
  with check (
    public.fn_is_platform_admin()
    or ((organization_id in (select public.fn_user_org_ids()))
        and public.fn_role_at_least(organization_id, 'manager'))
  );

-- ─── 8 · a função da cadeia de hash não é RPC ────────────────────────────────
-- Trigger function SECURITY DEFINER que ESCREVE em api_audit_log. O trigger
-- dispara com os privilégios do dono; EXECUTE é conferido ao CRIAR o trigger.
-- Nenhum papel de sessão precisa poder chamá-la — e sem este revoke o
-- PostgREST a expunha como RPC a qualquer usuário logado.
revoke execute on function public.fn_audit_hash_chain() from public, anon, authenticated;

notify pgrst, 'reload schema';
