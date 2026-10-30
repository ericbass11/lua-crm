---
impacto: exige_acao
secao: corrigido
titulo: Instalações do fork passam a atualizar somente pelo LUA CRM
---

Novas instalações agora clonam `ericbass11/lua-crm` e usam as quatro imagens publicadas em `ghcr.io/ericbass11`. O atualizador recusa uma `origin` de outra linhagem antes de buscar tags ou alterar a instalação. Quem já instalou este fork a partir de outro endereço deve rodar `git remote set-url origin https://github.com/ericbass11/lua-crm.git` uma vez antes da próxima atualização.

## Requer atenção

Antes da próxima atualização, instalações antigas do fork devem confirmar que a `origin` aponta para `https://github.com/ericbass11/lua-crm.git`. O atualizador recusa outra origem para impedir que código upstream sobrescreva recursos exclusivos, especialmente o Cliente Oculto.
