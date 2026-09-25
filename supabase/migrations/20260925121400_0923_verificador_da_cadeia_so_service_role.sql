-- 0923 — o verificador da cadeia de auditoria não é RPC de usuário.
--
-- A 0908 revogava apenas PUBLIC. Em instalações cujo default privilege concede
-- EXECUTE diretamente a authenticated, fn_verify_audit_chain(uuid) continuava
-- alcançável pelo PostgREST. Como ela é SECURITY DEFINER e recebe a organização
-- por argumento, um usuário do tenant A podia pedir a verificação do tenant B.
--
-- A função é ferramenta interna de integridade e já era documentada como
-- service-role-only. Fechamos as duas origens de privilégio explicitamente e
-- devolvemos EXECUTE apenas ao service_role. Nenhuma linha ou hash é alterado.
revoke execute on function public.fn_verify_audit_chain(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_verify_audit_chain(uuid) to service_role;

notify pgrst, 'reload schema';
