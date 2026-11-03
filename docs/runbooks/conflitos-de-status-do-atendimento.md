# Conflitos de status do atendimento

Destino: núcleo. O fechamento e a atualização de status fazem parte da operação
comum de todas as organizações, sem ativação de extensão.

## Correção

A migration `20261014120000_0926_service_status_business_conflicts.sql` redefine
somente `public.fn_service_status(uuid,uuid,text,bigint)`. As recusas
`service_stale` e `service_contact_changed` passam de `40001` a `PT409`.
O PostgREST converte `PT409` em HTTP 409, sem tratar a recusa permanente como
falha transitória de serialização. Assinatura, locks, regras de status, isolamento
por organização, `SECURITY DEFINER`, `search_path` e permissões são preservados.

Os dois consumidores HTTP aceitam `PT409` e o legado `40001` como conflito.
O retorno de erro ocorre antes da escrita posterior e da auditoria de sucesso.
O apêndice do baseline fica antes da varredura de permissões de `anon`, seguindo
a doutrina de migrations; as migrations históricas não são editadas.

## Validação local e publicação

Esta alteração é preparada para localhost. A aplicação e as medições em produção
permanecem pendentes de validação do usuário; criar a migration não a instala na
VPS. Consultar as evidências da sessão antes de considerar um teste como aprovado.

Em banco local isolado, conferir a definição instalada (não a primeira ocorrência
do nome no baseline):

```sql
select pg_get_functiondef('public.fn_service_status(uuid,uuid,text,bigint)'::regprocedure);
```

Confirmar os dois `PT409`, o `P0002` para atendimento inexistente e as permissões:

```sql
select role_name,
       has_function_privilege(role_name,
         'public.fn_service_status(uuid,uuid,text,bigint)', 'EXECUTE') as pode_executar
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name);
```

Esperado: somente `service_role` pode executar. Testar fechar com revisão atual,
repetir fechamento com a revisão antiga (409 sem alterações) e reabrir com a
revisão atual. Conferir que erros não produzem auditoria de sucesso ou escrita
de tags e que conversas de outra organização continuam inacessíveis.

Depois da validação, publicar pelo fluxo de deploy seguro da instalação, nesta
ordem: primeiro a aplicação que aceita `PT409` e `40001`; depois a migration do
banco. A aplicação nova funciona com o banco anterior. A aplicação antiga com o
banco corrigido pode mostrar erro 500 no conflito, embora a recusa preserve os
dados. Por isso o rollback da aplicação também precisa aceitar `PT409`; não
reverter a função para `40001` como parte de um rollback de imagem.

Antes e depois, comparar tempos do dashboard/Inbox, uso de recursos e deltas de
`pg_stat_database.xact_rollback`. A migration corrige novos pedidos; não se deve
assumir que encerra uma transação que já estava repetindo no backend. Qualquer
cancelamento ou reinício exige diagnóstico e execução operacional separados.

## Limite da correção

Não houve mudança de frontend nem de versão do PostgREST. Outras RPCs, incluindo
fluxos de Google/agenda e demanda, ainda podem conter recusas de negócio com
`40001`. Elas precisam de investigação e testes próprios antes de uma correção;
esta entrega não afirma eliminar todo risco de repetição ou toda lentidão.

## Laço de retorno

Entrada: fechamento da Inbox ou PATCH de status. Saída: status/revisão atualizados
ou HTTP 409 para revisão/contato obsoletos. Consumidores: os handlers de
`conversations` e `conversations/[id]/close`; a UI existente apresenta o conflito
e permite recarregar. A auditoria `conversation.closed` registra apenas sucesso;
o PATCH conserva sua auditoria de sucesso existente. Testes de API e banco devem
detectar regressões no código HTTP, nos efeitos e nas permissões. Sem nova tela,
worker, cron ou mecanismo de recuperação automática.
