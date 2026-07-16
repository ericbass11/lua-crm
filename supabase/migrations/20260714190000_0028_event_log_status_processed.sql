-- =============================================================================
-- 0028_event_log_status_processed
-- Fix: o agent-dispatcher (lib/ai/dispatcher/index.ts markEventProcessed)
-- grava event_log.status='processed', mas o check constraint original só
-- aceita pending|processing|done|dead. Resultado: TODO evento de IA fica
-- travado em 'processing' para sempre ("markEventProcessed failed ...
-- violates check constraint event_log_status_check" no log do app) e o
-- pipeline do bot nunca finaliza.
--
-- Correção: estende o check para incluir 'processed' (valor que o código
-- usa) mantendo os anteriores. Idempotente: drop if exists + re-create.
-- Também re-enfileira eventos presos em 'processing' há mais de 10 minutos
-- (auto-curativo para clones que já rodaram com o bug).
-- =============================================================================

alter table public.event_log
  drop constraint if exists event_log_status_check;

alter table public.event_log
  add constraint event_log_status_check
  check (status = any (array['pending'::text, 'processing'::text, 'processed'::text, 'done'::text, 'dead'::text]));

-- Auto-cura: eventos que ficaram presos em 'processing' pelo bug voltam
-- para 'pending' e serão re-consumidos pelo cron (idempotente por natureza:
-- só toca linhas antigas em 'processing').
update public.event_log
   set status = 'pending', updated_at = now()
 where status = 'processing'
   and updated_at < now() - interval '10 minutes';
