-- 0038_mystery_target_chat_id — corrige captura de inbound no Cliente Oculto.
-- O número do oculto é um WhatsApp real: QUALQUER contato pode mandar mensagem.
-- Sem casar o remetente com o alvo, mensagens de terceiros eram atribuídas à
-- campanha ativa (a IA reagiria ao contato errado). Guardamos o chatId REAL do
-- alvo (resolvido via check-exists, trata o 9º dígito) pra casar o inbound.
alter table public.mystery_shopper_campaigns
  add column if not exists target_chat_id text;
