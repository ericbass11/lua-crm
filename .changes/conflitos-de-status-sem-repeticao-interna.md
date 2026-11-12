---
impacto: nada_mudou
secao: corrigido
titulo: Conflitos ao fechar ou atualizar atendimentos retornam sem repetição interna
---

Uma revisão obsoleta ou um contato alterado durante a atualização do status
retorna HTTP 409 pelo PostgREST. Essas recusas de negócio deixam de usar o código
reservado a falhas de serialização, evitando a repetição interna do mesmo pedido
no PostgREST 14.17. As APIs reconhecem o código novo e o legado durante a atualização.
