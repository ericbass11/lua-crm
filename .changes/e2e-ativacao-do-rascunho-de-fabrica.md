---
impacto: nada_mudou
secao: corrigido
titulo: Ensaio da ativação preserva a origem do rascunho de fábrica
---

A jornada de QA mantém a criação e a recusa de ativação sem chave. Na fase
positiva, prepara a credencial sintética cifrada antes de recriar o rascunho
pela tela e produz um novo recibo pelo ensaio real. A fixture deixa de alterar
a configuração da versão depois da criação, alteração que corretamente exige
revisão pelo gate de publicação. O ambiente continua efêmero, sem chave externa,
sem worker de envio e com limpeza da credencial e do canal preparados no teste.
