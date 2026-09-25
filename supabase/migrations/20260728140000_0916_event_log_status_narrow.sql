-- 0085 — event_log.status volta ao vocabulário canônico (pending|processing|done|dead)
--
-- POR QUÊ: a 0028 desta instalação alargou `event_log_status_check` para aceitar
-- 'processed', porque o agent-dispatcher da época gravava esse valor e todo evento
-- de IA travava em 'processing'. O upstream (DeskcommCRM) consertou o MESMO bug pelo
-- outro lado — G6-05/INB-13: o dispatcher passou a gravar 'done', que já era válido —
-- e criou o invariante `tests/invariants/dispatcher-event-status.test.ts`, que exige
-- que 'processed' e 'failed' sejam REJEITADOS pela constraint.
--
-- Na sincronização com o upstream (2026-07-28) o código do dispatcher passou a ser o
-- do upstream: nenhum escritor grava mais 'processed' (verificado por varredura em
-- lib/, app/ e workers/). Manter a constraint alargada deixaria a porta aberta para o
-- valor voltar sem ninguém perceber — e é exatamente isso que o invariante barra.
--
-- Forward-fix, não edição: a 0028 já foi aplicada em bancos existentes (inclusive o de
-- produção), e a doutrina proíbe reescrever migration aplicada.
--
-- DADO ANTES DA CONSTRAINT: qualquer linha em 'processed' vira 'done' — se a constraint
-- fosse criada antes, o `update.sh` de um clone com linhas nesse estado quebraria.
-- 'processed' significava "consumido com sucesso", que é precisamente 'done'.
--
-- Idempotente e auto-curativa: pode ser re-aplicada sem efeito duplicado.

update public.event_log
   set status = 'done', updated_at = now()
 where status = 'processed';

-- 'failed' nunca fez parte do vocabulário desta coluna, mas o invariante também o
-- cobre; se algum clone tiver linhas assim, o destino correto é a caixa morta.
update public.event_log
   set status = 'dead', updated_at = now()
 where status = 'failed';

alter table public.event_log
  drop constraint if exists event_log_status_check;
alter table public.event_log
  add constraint event_log_status_check
  check (status = any (array['pending'::text, 'processing'::text, 'done'::text, 'dead'::text]));
