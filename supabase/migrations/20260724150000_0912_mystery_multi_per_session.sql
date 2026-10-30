-- 0039_mystery_multi_per_session — permite VÁRIAS auditorias simultâneas no
-- mesmo número do oculto (uma por empresa-alvo). Antes o índice limitava a 1
-- campanha 'running' por sessão. Agora a unicidade é por (sessão, alvo): dá pra
-- auditar N empresas ao mesmo tempo, mas não a MESMA empresa duas vezes no
-- mesmo número (seria a mesma conversa no WhatsApp). O roteamento do inbound é
-- por target_chat_id (migration 0038).
drop index if exists public.uniq_mystery_active_per_session;
create unique index if not exists uniq_mystery_active_session_target
  on public.mystery_shopper_campaigns (shopper_session_id, target_chat_id)
  where status = 'running';
