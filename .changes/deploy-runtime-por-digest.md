---
impacto: nada_mudou
secao: adicionado
titulo: Publicação opcional com imagens verificadas e rollback dos runtimes
---

O caminho sancionado `scripts/safe-deploy.sh` aceita um modo opcional
`--production-images` com manifesto de imagens por digest, revisão OCI alinhada
e evidências CI do mesmo commit. Staging mantém consumidores desligados; cutover
exige confirmação do congelamento da origem. Falhas restauram imagens e o estado
anterior de app, worker e scheduler; primeira instalação interrompe o conjunto
novo sem apagar volumes. O modo existente de build local permanece igual.
