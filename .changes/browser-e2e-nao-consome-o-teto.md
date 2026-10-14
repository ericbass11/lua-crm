---
impacto: nada_mudou
secao: corrigido
titulo: Preparo do Chromium no CI tem rede e duração limitadas
---

O CI usa o arquivo oficial Ubuntu por HTTPS quando encontra a URI do mirror
Azure, preservando as opções de assinatura e os demais repositórios.
A instalação das dependências e do Chromium recebe limites de rede e execução,
sem alterar o teto do job ou reduzir a suíte E2E.
