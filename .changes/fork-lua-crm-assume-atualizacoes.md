---
impacto: exige_acao
secao: corrigido
titulo: Instalações do fork passam a atualizar somente pelo LUA CRM
---

Novas instalações agora clonam `ericbass11/lua-crm` e usam as quatro imagens publicadas em `ghcr.io/ericbass11`. O atualizador recusa uma `origin` de outra linhagem antes de buscar tags ou alterar a instalação. Quem já instalou este fork a partir de outro endereço deve rodar `git remote set-url origin https://github.com/ericbass11/lua-crm.git` uma vez antes da próxima atualização.
