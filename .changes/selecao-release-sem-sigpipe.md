---
impacto: nada_mudou
secao: corrigido
titulo: Seleção de versão preservada em listas grandes de tags
---

A leitura da primeira versão válida consome a lista inteira de referências,
evitando que SIGPIPE descarte uma versão já encontrada sob `pipefail`.
A ordenação e os critérios de seleção permanecem iguais, sem novos passos
para o operador. Uma prova com 20.001 referências cobre essa falha.
