---
impacto: nada_mudou
secao: corrigido
titulo: Dependências corrigidas antes da publicação na VPS
---

Atualiza Next.js para 16.3.6 e o SDK MCP para 1.31.0. Eleva os pisos de sharp,
fast-uri, ip-address, proxy-addr, seroval, source-map-js e brace-expansion 5.x
para versões corrigidas, preservando as árvores das outras majors. O lockfile
registra as versões efetivas; a instalação continua usando `--frozen-lockfile`.

Os avisos incluem a implementação Node de `next/og ImageResponse`
([GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)),
o cliente OAuth do SDK MCP
([GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)) e
dependências transitivas. A atualização das bibliotecas não altera as regras
de negócio nem representa migração dos dados ou publicação do servidor.
