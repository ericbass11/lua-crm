#!/usr/bin/env bash
#
# GUARDRAIL DE DEPLOY — único caminho sancionado para colocar código novo no ar.
#
#   bash scripts/safe-deploy.sh
#
# Garante que nenhuma alteração de código afete o funcionamento do app:
#   1. Snapshot da imagem atual (rollback garantido)
#   2. Build — typecheck estrito + lint são o portão (falhou = nada muda no ar)
#   3. Deploy
#   4. Health gate: /api/v1/health saudável + sanity de rotas críticas
#   5. Falhou qualquer etapa → ROLLBACK AUTOMÁTICO para a imagem anterior
#
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="-f docker-compose.prod.yml -f docker-compose.local.yml"
BUILD="-f docker-compose.prod.yml -f docker-compose.build.yml"
step() { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }

step "1/5 Snapshot de rollback"
# Resolve container e imagem-alvo DINAMICAMENTE — nunca hardcode de nome. O
# rebrand (deskcomm→lua-crm) deixou nomes divergentes (container real
# `deskcommcrm-app-1` / imagem `deskcomm-app:local`) e o snapshot hardcoded
# falhava em silêncio, matando a rede de rollback. Aqui: tag-alvo vem do .env
# (o que o compose realmente sobe) e a imagem viva vem do container em execução.
APP_IMAGE_REF=$(awk '/^APP_IMAGE=/{sub(/^APP_IMAGE=/,"");gsub(/[" \r]/,"");print;exit}' .env 2>/dev/null || echo "")
APP_IMAGE_REF=${APP_IMAGE_REF:-lua-crm-app:local}
ROLLBACK_REF="${APP_IMAGE_REF%:*}:rollback"
APP_CONTAINER=$(docker compose $COMPOSE ps -q app 2>/dev/null | head -1 || echo "")
CURRENT=""
if [ -n "$APP_CONTAINER" ]; then
  CURRENT=$(docker inspect --format '{{.Image}}' "$APP_CONTAINER" 2>/dev/null || echo "")
fi
# A imagem que o contêiner referencia pode NÃO EXISTIR mais: basta alguém ter
# buildado por fora antes de chamar este script. O build move a tag `:local`
# para a imagem nova, a antiga fica órfã e o Docker a poda — o contêiner segue
# rodando de camadas que já não têm nome nem registro. Aconteceu em 2026-08-25,
# no sync da v1.4.1, e o sintoma era hostil: `docker tag` respondia
# "No such image: sha256:…" e o `set -e` matava o script no passo 1, sem dizer
# uma palavra sobre rollback. `docker commit` do contêiner vivo também não
# salva — ele precisa das camadas-base, que são justamente as que sumiram.
#
# Este script JÁ tinha um caminho para "não há o que salvar" (app parado).
# Agora ele cobre os dois, e em voz alta: perder a rede de segurança tem de ser
# uma decisão consciente de quem está lendo, não um erro de daemon.
if [ -n "$CURRENT" ] && ! docker image inspect "$CURRENT" >/dev/null 2>&1; then
  echo "  ⚠ a imagem do contêiner em execução (${CURRENT:0:26}...) NÃO existe mais."
  echo "    Provável causa: build feito FORA deste script, que moveu a tag e"
  echo "    deixou a imagem anterior órfã (o Docker a podou)."
  echo "    Para ter rede de segurança, builde a versão anterior a partir da"
  echo "    branch de backup e tagueie como $ROLLBACK_REF antes de seguir."
  CURRENT=""
fi

if [ -n "$CURRENT" ]; then
  docker tag "$CURRENT" "$ROLLBACK_REF"
  echo "  rollback ($ROLLBACK_REF) aponta para ${CURRENT:0:26}..."
else
  echo "  ⚠ SEM SNAPSHOT — este deploy NÃO tem rollback automático."
fi

step "2/5 Build (typecheck estrito + lint = portão de qualidade)"
docker compose $BUILD build app

step "3/5 Deploy"
docker compose $COMPOSE up -d app

step "4/5 Health gate"
ok=0
for i in $(seq 1 30); do
  H=$(curl -s --max-time 5 http://localhost:3000/api/v1/health || true)
  if echo "$H" | grep -q '"status":"healthy"'; then ok=1; break; fi
  sleep 3
done
[ "$ok" = 1 ] && echo "  ✓ /api/v1/health saudável" || echo "  ✖ health não ficou saudável em 90s"

# Sanity de rotas críticas: cada uma deve devolver o código esperado.
if [ "$ok" = 1 ]; then
  while read -r path want; do
    got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:3000${path}" || echo 000)
    if [ "$got" = "$want" ]; then
      echo "  ✓ ${path} -> ${got}"
    else
      echo "  ✖ ${path} -> ${got} (esperado ${want})"
      ok=0
      break
    fi
  # `/` devolve 307 desde a sincronização com o upstream (2026-07-28): a raiz
  # deixou de ter conteúdo próprio e passou a redirecionar para /app (o proxy
  # trata `/` como rota pública, então quem redireciona é a própria page). Por
  # isso /login entrou na lista: é uma página que tem de RENDERIZAR de verdade,
  # senão o portão só provaria que redirecionamentos funcionam.
  done <<'PROBES'
/ 307
/login 200
/api/v1/integrations/calendar 401
/api/v1/auth/realtime-token 401
/api/v1/settings/followup 401
PROBES
fi

if [ "$ok" = 1 ]; then
  step "5/5 ✔ DEPLOY VALIDADO — app funcionando"
  exit 0
fi

step "5/5 ✖ VERIFICAÇÃO FALHOU — rollback automático"
if docker image inspect "$ROLLBACK_REF" >/dev/null 2>&1; then
  docker tag "$ROLLBACK_REF" "$APP_IMAGE_REF"
  docker compose $COMPOSE up -d app
  echo "  Rollback aplicado ($ROLLBACK_REF -> $APP_IMAGE_REF; imagem anterior no ar)."
  echo "  Investigue a causa antes de tentar de novo."
  echo "  Se a mudança for arriscada por natureza, PARE e envie para avaliação humana."
else
  echo "  ✖ SEM imagem de rollback ($ROLLBACK_REF) — INTERVENÇÃO HUMANA NECESSÁRIA."
fi
exit 1
