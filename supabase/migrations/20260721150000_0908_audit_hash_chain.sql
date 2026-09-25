-- 0035_audit_hash_chain — tamper-evidence do api_audit_log via cadeia de hash.
--
-- Vision "provar o que a IA (e qualquer ator) fez": o audit log já era
-- append-only (sem policy de UPDATE/DELETE), mas um admin com acesso ao banco
-- podia alterar/apagar linhas sem deixar rastro. Aqui cada linha passa a
-- encadear SHA-256 sobre (prev_hash || conteúdo canônico). Alterar OU apagar
-- qualquer linha quebra a verificação de todas as posteriores daquela org.
--
-- ADITIVO (nenhum dado perdido). O trigger BEFORE INSERT preenche prev/entry
-- hash automaticamente — o app não muda (o writer continua inserindo igual).
-- `chain_seq` (sequência global) dá ordem determinística por org, à prova de
-- corrida e de timestamps colididos (ordenar por created_at+uuid random não é).
-- Idempotente e auto-curativo (re-aplicável em clones via update.sh).

-- 1) Colunas da cadeia.
alter table public.api_audit_log add column if not exists prev_hash bytea;
alter table public.api_audit_log add column if not exists entry_hash bytea;

-- 2) Sequência de ordenação + coluna.
create sequence if not exists public.api_audit_log_chain_seq;
alter table public.api_audit_log add column if not exists chain_seq bigint;

-- 3) Backfill de chain_seq para linhas pré-existentes (idempotente: só as NULL,
--    continuando após o maior valor já atribuído). Ordem estável por tempo+id.
with mx as (select coalesce(max(chain_seq), 0) as m from public.api_audit_log),
ordered as (
  select id, row_number() over (order by created_at asc, id asc) as rn
    from public.api_audit_log
   where chain_seq is null
)
update public.api_audit_log a
   set chain_seq = (select m from mx) + o.rn
  from ordered o
 where a.id = o.id;

-- 4) Novas linhas recebem chain_seq monotônico automaticamente (o default é
--    avaliado ANTES do trigger BEFORE INSERT).
alter table public.api_audit_log
  alter column chain_seq set default nextval('public.api_audit_log_chain_seq');

-- 5) Avança a sequência para além do maior chain_seq já existente.
select setval(
  'public.api_audit_log_chain_seq',
  greatest((select coalesce(max(chain_seq), 0) from public.api_audit_log), 1)
);

-- 6) Índice p/ o "última linha da org" do trigger e p/ o verificador.
create index if not exists api_audit_log_chain_idx
  on public.api_audit_log (organization_id, chain_seq desc);

-- 7) Conteúdo canônico de uma linha (determinístico + TZ-independente).
create or replace function public.fn_audit_row_digest_input(
  p_prev bytea, p_org uuid, p_actor uuid, p_token uuid, p_admin boolean,
  p_action text, p_rtype text, p_rid uuid, p_request text, p_bypassed boolean,
  p_metadata jsonb, p_created timestamptz
) returns text language sql immutable set search_path = public as $$
  select
    coalesce(encode(p_prev, 'hex'), '') || '|' ||
    coalesce(p_org::text, '')     || '|' ||
    coalesce(p_actor::text, '')   || '|' ||
    coalesce(p_token::text, '')   || '|' ||
    coalesce(p_admin::text, '')   || '|' ||
    coalesce(p_action, '')        || '|' ||
    coalesce(p_rtype, '')         || '|' ||
    coalesce(p_rid::text, '')     || '|' ||
    coalesce(p_request, '')       || '|' ||
    coalesce(p_bypassed::text, '')|| '|' ||
    coalesce(p_metadata::text, '')|| '|' ||
    coalesce(to_char(p_created at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'), '');
$$;

-- 8) Trigger: encadeia cada INSERT. SECURITY DEFINER p/ enxergar a cadeia real
--    da org independentemente de RLS. Serializa por org (audit é baixa
--    concorrência) evitando fork sob corrida.
create or replace function public.fn_audit_hash_chain()
returns trigger language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_prev bytea;
begin
  perform pg_advisory_xact_lock(
    hashtext('audit_chain:' || coalesce(new.organization_id::text, 'global')));

  select entry_hash into v_prev
    from public.api_audit_log
   where organization_id is not distinct from new.organization_id
     and entry_hash is not null
   order by chain_seq desc
   limit 1;

  new.prev_hash := v_prev;
  new.entry_hash := digest(
    public.fn_audit_row_digest_input(
      v_prev, new.organization_id, new.actor_user_id, new.actor_api_token_id,
      new.acting_as_platform_admin, new.action, new.resource_type, new.resource_id,
      new.request_id, new.bypassed_rls, new.metadata, new.created_at),
    'sha256');
  return new;
end; $$;

drop trigger if exists trg_audit_hash_chain on public.api_audit_log;
create trigger trg_audit_hash_chain
  before insert on public.api_audit_log
  for each row execute function public.fn_audit_hash_chain();

-- 9) Verificador: retorna a 1ª linha onde a cadeia quebra (vazio = íntegra).
create or replace function public.fn_verify_audit_chain(p_org uuid)
returns table(broken_id uuid, broken_at timestamptz, reason text)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  r record;
  v_prev bytea := null;
  v_expected bytea;
begin
  for r in
    select * from public.api_audit_log
     where organization_id is not distinct from p_org and entry_hash is not null
     order by chain_seq asc
  loop
    if r.prev_hash is distinct from v_prev then
      broken_id := r.id; broken_at := r.created_at; reason := 'prev_hash_mismatch';
      return next; return;
    end if;
    v_expected := digest(
      public.fn_audit_row_digest_input(
        v_prev, r.organization_id, r.actor_user_id, r.actor_api_token_id,
        r.acting_as_platform_admin, r.action, r.resource_type, r.resource_id,
        r.request_id, r.bypassed_rls, r.metadata, r.created_at),
      'sha256');
    if r.entry_hash is distinct from v_expected then
      broken_id := r.id; broken_at := r.created_at; reason := 'entry_hash_mismatch';
      return next; return;
    end if;
    v_prev := r.entry_hash;
  end loop;
end; $$;

-- 10) Backfill idempotente dos hashes das linhas pré-existentes (só as NULL),
--     por org, em ordem de chain_seq.
do $$
declare
  o record; r record; v_prev bytea;
begin
  for o in select distinct organization_id from public.api_audit_log loop
    v_prev := null;
    for r in
      select * from public.api_audit_log
       where organization_id is not distinct from o.organization_id
       order by chain_seq asc
    loop
      if r.entry_hash is null then
        update public.api_audit_log
           set prev_hash = v_prev,
               entry_hash = digest(
                 public.fn_audit_row_digest_input(
                   v_prev, r.organization_id, r.actor_user_id, r.actor_api_token_id,
                   r.acting_as_platform_admin, r.action, r.resource_type, r.resource_id,
                   r.request_id, r.bypassed_rls, r.metadata, r.created_at),
                 'sha256')
         where id = r.id
        returning entry_hash into v_prev;
      else
        v_prev := r.entry_hash;
      end if;
    end loop;
  end loop;
end $$;

-- 11) Verificador é interno (service_role/admin), não exposto a anon.
revoke all on function public.fn_verify_audit_chain(uuid) from public;
grant execute on function public.fn_verify_audit_chain(uuid) to service_role;
