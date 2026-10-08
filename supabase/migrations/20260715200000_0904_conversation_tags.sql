-- =============================================================================
-- 0031_conversation_tags
-- Tags de conversa aplicáveis pela IA.
--
-- `tag_definitions`: catálogo por org (nome + descrição de QUANDO usar — a
-- descrição é injetada no contexto do agente para ele decidir; cor pra UI).
-- `conversations.tags text[]`: padrão de modelagem do CLAUDE.md (text[] + GIN).
-- A IA aplica via tool crm_tag_conversation (valida contra o catálogo).
--
-- Idempotente.
-- =============================================================================

create table if not exists public.tag_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  -- "Quando aplicar" — orienta a IA (ex.: "cliente pediu preço ou orçamento")
  description text not null default '',
  color text not null default 'gray',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tag_definitions_name_check check (char_length(name) between 1 and 40),
  constraint tag_definitions_color_check check (color in ('gray','red','orange','yellow','green','blue','purple')),
  constraint tag_definitions_org_name_unique unique (organization_id, name)
);

alter table public.tag_definitions enable row level security;

drop policy if exists tenant_isolation_tag_definitions_select on public.tag_definitions;
create policy tenant_isolation_tag_definitions_select
  on public.tag_definitions for select
  using (organization_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_tag_definitions_modify on public.tag_definitions;
create policy tenant_isolation_tag_definitions_modify
  on public.tag_definitions
  using (organization_id in (select fn_user_org_ids()))
  with check (organization_id in (select fn_user_org_ids()));

grant all on table public.tag_definitions to service_role;
grant select, insert, update, delete on table public.tag_definitions to authenticated;

alter table public.conversations
  add column if not exists tags text[] not null default '{}';

create index if not exists conversations_tags_gin_idx
  on public.conversations using gin (tags);
