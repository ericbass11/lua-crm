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
CURRENT=$(docker inspect --format '{{.Image}}' deskcommcrm-app-1 2>/dev/null || echo "")
if [ -n "$CURRENT" ]; then
  docker tag "$CURRENT" deskcomm-app:rollback
  echo "  rollback aponta para ${CURRENT:0:19}..."
else
  echo "  (app não está rodando — sem snapshot)"
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
  done <<'PROBES'
/ 200
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
if docker image inspect deskcomm-app:rollback >/dev/null 2>&1; then
  docker tag deskcomm-app:rollback deskcomm-app:local
  docker compose $COMPOSE up -d app
  echo "  Rollback aplicado (imagem anterior no ar). Investigue a causa antes de tentar de novo."
  echo "  Se a mudança for arriscada por natureza, PARE e envie para avaliação humana."
else
  echo "  ✖ SEM imagem de rollback — INTERVENÇÃO HUMANA NECESSÁRIA."
fi
exit 1
