-- 0924 — DID routing is an internal service-role operation, never a tenant RPC.
-- Preserve the existing routing query and repair privileges inherited from defaults.
alter function public.fn_resolve_inbound_number(text) set search_path = public, pg_temp;
revoke execute on function public.fn_resolve_inbound_number(text) from public, anon, authenticated;
grant execute on function public.fn_resolve_inbound_number(text) to service_role;

notify pgrst, 'reload schema';
