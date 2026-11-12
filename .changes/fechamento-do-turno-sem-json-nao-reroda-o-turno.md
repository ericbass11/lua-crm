---
impacto: nada_mudou
secao: corrigido
titulo: Fechamento do turno sem JSON não repete o atendimento
---

O resumo de fechamento que o agente escreve depois de responder agora é pedido
no modo JSON do provedor. Se vier sem JSON, o pedido é repetido uma vez, e só o
fechamento é repetido. Se o agente já falou com o cliente e o fechamento falhar
de novo, o turno grava o resumo anterior e termina. Antes, o atendimento
inteiro voltava para a fila depois de a resposta ter saído.
