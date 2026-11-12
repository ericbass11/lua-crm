-- 0926 — Conflitos de atendimento são recusas de negócio (HTTP 409).
-- SQLSTATE 40001 é reservado a falhas transitórias de serialização: no
-- PostgREST 14.17 ele pode reexecutar internamente uma revisão obsoleta.
-- Corpo, assinatura, locks e permissões preservados; somente os dois códigos mudam.

create or replace function public.fn_service_status(p_org uuid,p_conversation uuid,p_status text,p_expected bigint default null)
returns public.conversations language plpgsql security definer set search_path=public as $$
declare c public.conversations; terminal boolean; pre_contact uuid;
begin
 if p_status not in ('closed','resolved','archived','open','pending','ai_handling','claimed') then
  raise exception 'invalid_status' using errcode='22023'; end if;
 select * into c from public.conversations where id=p_conversation and organization_id=p_org;
 if not found then raise exception 'service_not_found' using errcode='P0002'; end if;
 pre_contact:=c.contact_id;
 perform public.fn_service_lock(p_org,c.contact_id);
 select * into c from public.conversations where id=p_conversation and organization_id=p_org for no key update;
 if c.contact_id is distinct from pre_contact then raise exception 'service_contact_changed' using errcode='PT409'; end if;
 if p_expected is not null and c.service_revision<>p_expected then raise exception 'service_stale' using errcode='PT409'; end if;
 if c.status=p_status then return c; end if;
 terminal := p_status in ('closed','resolved','archived');
 update public.conversations set status=p_status,status_changed_at=clock_timestamp(),
   service_revision=service_revision+case when terminal or c.status in ('closed','resolved','archived') then 1 else 0 end,
   service_closed_at=case when terminal then clock_timestamp() else service_closed_at end,
   service_started_at=case when c.status in ('closed','resolved','archived') and not terminal then clock_timestamp() else service_started_at end,
   bot_silenced_until=case when terminal and last_handoff_at is null then null else bot_silenced_until end,
   current_demanda_id=case when c.status in ('closed','resolved','archived') and not terminal then null else current_demanda_id end
  where id=c.id and organization_id=p_org returning * into c;
 if terminal then
   update public.demandas set proximo_passo=coalesce(proximo_passo,'Revisar atendimento e registrar o desfecho da demanda')
    where organization_id=p_org and id=c.current_demanda_id and fechada_em is null;
 end if;
 return c;
end; $$;
revoke execute on function public.fn_service_status(uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.fn_service_status(uuid,uuid,text,bigint) to service_role;
