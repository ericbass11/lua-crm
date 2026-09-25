-- 0086 — warm-up: idade do número vem da conexão, não do dia em que os knobs foram salvos
--
-- BUG: `channel_knobs.number_activated_at` é `not null default now()`, e nada preenchia
-- a coluna. Resultado: a linha nascia com a data do PRIMEIRO SALVAMENTO da tela de
-- Proteção de envio, e o motor (lib/agent-engine/pacing/engine.ts) calcula a idade do
-- número a partir dela. Um número conectado há meses, ao ter o pacing configurado hoje,
-- voltava ao degrau mais conservador do warm-up (20 envios/dia) — e o teto do CRM
-- (channel_sessions.daily_message_limit) ficava inalcançável, porque o efetivo é
-- `min(warm-up, teto do CRM)`. Configurar a proteção PIORAVA o limite, o que é o
-- oposto do que a tela promete.
--
-- CORREÇÃO: onde a ativação registrada é POSTERIOR à criação da conexão, ela passa a ser
-- a criação da conexão — a melhor referência que o CRM tem de "desde quando este número
-- envia por aqui".
--
-- POR QUE `>` E NÃO SOBRESCREVER SEMPRE: esta migration só ANDA PARA TRÁS, e só no caso
-- comprovadamente errado. Data ANTERIOR ao created_at é declaração deliberada do operador
-- (número que já enviava por outro sistema, com reputação que o CRM não conhece) e fica
-- INTOCADA. Sem esse cuidado, um clone perderia a informação que só o humano tinha.
--
-- EFEITO NOS LIMITES: números com mais de 4 dias de conexão sobem de 20/dia para o degrau
-- da idade real (50 / 100 / 200 / sem cap de warm-up), sempre limitados pelo teto do CRM.
-- É correção de contagem errada, não afrouxamento de política: os degraus não mudaram.
--
-- Idempotente: re-aplicar não tem efeito (a condição deixa de casar depois da 1ª vez).

update public.channel_knobs k
   set number_activated_at = s.created_at
  from public.channel_sessions s
 where s.id = k.channel_session_id
   and k.number_activated_at > s.created_at;
