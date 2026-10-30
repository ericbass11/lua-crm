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

# Opt-in immutable publication: keeps the legacy local build path unchanged.
production_images() {
  local manifest='' runtime_env='' phase='' confirmed=0 snapshot='' mutation=0
  local -a files=() dc=() images=() changed=() old_images=() old_running=()
  local arg service id details revision rollback_failed=0
  while (($#)); do
    arg=$1; shift
    case "$arg" in
      --production-images|--compose-file|--env-file|--phase)
        (($#)) || { echo "Missing value for $arg" >&2; return 2; }
        case "$arg" in
          --production-images) manifest=$1 ;;
          --compose-file) files+=(-f "$1") ;;
          --env-file) runtime_env=$1 ;;
          --phase) phase=$1 ;;
        esac
        shift ;;
      --cutover-confirmed) confirmed=1 ;;
      *) echo "Unknown production option: $arg" >&2; return 2 ;;
    esac
  done
  [[ -f $manifest && -f $runtime_env && ${#files[@]} -gt 0 ]] || { echo 'Require manifest, protected env and compose files' >&2; return 2; }
  [[ $phase == staging || $phase == cutover ]] || { echo 'Require --phase staging|cutover' >&2; return 2; }
  [[ $phase != cutover || $confirmed == 1 ]] || { echo 'Cutover requires --cutover-confirmed after source freeze and final restore' >&2; return 2; }
  command -v python3 >/dev/null
  command -v flock >/dev/null
  umask 077
  # Fail closed on missing CI workflows. Evidence must be exported and independently verified.
  local parsed
  parsed=$(python3 - "$manifest" "$runtime_env" <<'PY'
import json, os, re, stat, sys
m=json.load(open(sys.argv[1], encoding='utf-8'))
if not os.path.isabs(sys.argv[2]): raise SystemExit('Runtime env path must be absolute')
s=os.lstat(sys.argv[2])
if not stat.S_ISREG(s.st_mode) or s.st_mode & 0o077:
    raise SystemExit('Runtime env must be a regular file with mode 600 or stricter')
r=m.get('revision', '')
if not re.fullmatch(r'[0-9a-f]{40}',r): raise SystemExit('Require full revision SHA')
c=m.get('ci',{})
if c.get('revision')!=r or c.get('status')!='success': raise SystemExit('CI revision/status mismatch')
checks=c.get('checks',{})
for name in ['ci','e2e','perf','docker']:
    check=checks.get(name,{})
    if check.get('revision')!=r or check.get('status')!='success' or not re.fullmatch(r'https://github\.com/[^/]+/[^/]+/actions/runs/[0-9]+',check.get('url','')):
        raise SystemExit('Missing successful CI evidence: '+name)
print(r)
for key in ['APP_IMAGE','WORKER_IMAGE','SCHEDULER_IMAGE']:
    v=m.get(key,'')
    if not re.fullmatch(r'[^\s]+@sha256:[0-9a-f]{64}',v): raise SystemExit(key+': immutable digest required')
    print(v)
PY
  )
  mapfile -t images <<< "$parsed"
  revision=${images[0]}
  export APP_IMAGE=${images[1]} WORKER_IMAGE=${images[2]} SCHEDULER_IMAGE=${images[3]}
  export LUA_ENV_FILE="$runtime_env"
  export COMPOSE_PROFILES=""
  dc=(docker compose --env-file "$runtime_env" "${files[@]}")
  [[ $phase != cutover ]] || dc+=(--profile cutover)
  # Serializes all opted-in publications using this environment directory.
  exec 9>"$(dirname "$runtime_env")/.safe-deploy.lock"
  flock -n 9 || { echo 'Another production deployment is active' >&2; return 1; }
  snapshot=$(mktemp -d "$(dirname "$runtime_env")/.safe-deploy.XXXXXXXX")
  # Revalidate and copy through a no-follow descriptor; a swapped symlink is refused.
  python3 - "$runtime_env" "$snapshot/runtime.env" <<'PY'
import os, shutil, stat, sys
fd=os.open(sys.argv[1],os.O_RDONLY|os.O_NOFOLLOW)
with os.fdopen(fd,'rb') as src:
    s=os.fstat(src.fileno())
    if not stat.S_ISREG(s.st_mode) or s.st_mode & 0o077: raise SystemExit('Unsafe runtime env at snapshot')
    with open(sys.argv[2],'xb') as dst: shutil.copyfileobj(src,dst)
PY
  "${dc[@]}" config --format json --no-env-resolution >"$snapshot/effective-compose.json"
  python3 - "$snapshot/effective-compose.json" "$manifest" "$runtime_env" <<'PY'
import json, os, sys
c=json.load(open(sys.argv[1]));m=json.load(open(sys.argv[2]));services=c.get('services',{})
for name,key in [('app','APP_IMAGE'),('worker','WORKER_IMAGE'),('scheduler','SCHEDULER_IMAGE')]:
    v=services.get(name,{})
    if v.get('image')!=m[key] or v.get('build'): raise SystemExit('Effective runtime image/build mismatch: '+name)
    envfiles=v.get('env_file',[])
    paths=[x.get('path') if isinstance(x,dict) else x for x in envfiles]
    if paths!=[sys.argv[3]]: raise SystemExit('Effective runtime env mismatch: '+name)
    if name=='app' and v.get('profiles'): raise SystemExit('App must be enabled by default')
    if name!='app' and v.get('profiles')!=['cutover']: raise SystemExit('Consumer must require cutover profile: '+name)
for name in ['app','worker','scheduler','waha','redis','srh']:
    v=services.get(name,{})
    if not v or v.get('ports'): raise SystemExit('Missing/private service port contract: '+name)
if services['waha'].get('profiles')!=['cutover']: raise SystemExit('WAHA must require cutover profile')
if 'caddy' in services and not services['caddy'].get('profiles'): raise SystemExit('Bundled Caddy must be disabled')
PY
  cp -- "$manifest" "$snapshot/release.json"
  local i=1
  while ((i<${#files[@]})); do cp -- "${files[i]}" "$snapshot/compose-$i.yml"; i=$((i+2)); done
  changed=(app)
  [[ $phase != cutover ]] || changed=(app worker scheduler)
  for service in worker scheduler waha; do
    if [[ $phase == staging && -n $("${dc[@]}" ps --status running -q "$service") ]]; then
      echo 'Staging refuses active outbound consumers' >&2; return 1
    fi
  done
  for service in "${changed[@]}"; do
    id=$("${dc[@]}" ps -a -q "$service")
    [[ $id != *$'\n'* ]] || { echo 'Scaled services are not supported by this rollback contract' >&2; return 1; }
    details=''; [[ -z $id ]] || details=$(docker inspect --format '{{.Image}} {{.State.Running}}' "$id")
    old_images+=("${details%% *}"); old_running+=("${details##* }")
    [[ -z $details ]] || docker image inspect "${details%% *}" >/dev/null
  done
  for i in "${!changed[@]}"; do printf '%s\t%s\t%s\n' "${changed[i]}" "${old_images[i]}" "${old_running[i]}" >>"$snapshot/previous-runtimes.tsv"; done
  # No container mutations until all runtime digests are available and match the same SHA.
  for id in "${images[@]:1}"; do
    docker pull "$id" >/dev/null
    details=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$id")
    [[ $details == "$revision" ]] || { echo 'OCI image revision mismatch' >&2; return 1; }
  done
  rollback_production() {
    local rc=$1 n restore_service
    trap - ERR INT TERM
    if ((mutation)); then
      echo 'Publication failed; restoring every changed runtime service' >&2
      printf 'services:\n' >"$snapshot/rollback.yml"
      for n in "${!changed[@]}"; do
        [[ -z ${old_images[n]} ]] || printf '  %s:\n    image: "%s"\n    pull_policy: never\n    depends_on: !override {}\n' "${changed[n]}" "${old_images[n]}" >>"$snapshot/rollback.yml"
      done
      "${dc[@]}" stop "${changed[@]}" || rollback_failed=1
      for n in "${!changed[@]}"; do
        restore_service=${changed[n]}
        if [[ -z ${old_images[n]} ]]; then
          "${dc[@]}" stop "$restore_service" || rollback_failed=1
        else
          if [[ ${old_running[n]} == true ]]; then
            "${dc[@]}" -f "$snapshot/rollback.yml" up -d --pull never --no-build --no-deps "$restore_service" || rollback_failed=1
          else
            # Recreate stopped services without briefly launching their consumers.
            "${dc[@]}" -f "$snapshot/rollback.yml" create --pull never --no-build "$restore_service" || rollback_failed=1
          fi
        fi
      done
      ((rollback_failed==0)) || echo 'Rollback incomplete: operator recovery required' >&2
    fi
    echo "Protected deployment snapshot: $snapshot" >&2
    exit "$rc"
  }
  trap 'rollback_production $?' ERR
  trap 'rollback_production 130' INT
  trap 'rollback_production 143' TERM
  mutation=1
  "${dc[@]}" up -d --pull never --no-build --no-deps "${changed[@]}"
  # Verify the actual container image IDs, not just the supplied references/labels.
  for service in "${changed[@]}"; do
    case "$service" in app) arg=$APP_IMAGE ;; worker) arg=$WORKER_IMAGE ;; scheduler) arg=$SCHEDULER_IMAGE ;; esac
    details=$(docker image inspect --format '{{.Id}}' "$arg")
    id=$("${dc[@]}" ps -q "$service")
    [[ -n $id && $id != *$'\n'* && $(docker inspect --format '{{.Image}}' "$id") == "$details" ]]
  done
  local healthy=0
  for ((i=0;i<30;i++)); do
    if "${dc[@]}" exec -T app node - "$phase" <<'JS'
(async()=>{
 const phase=process.argv[2];
 const request=(path)=>fetch('http://127.0.0.1:3000'+path,{redirect:'manual',signal:AbortSignal.timeout(10000)});
 const h=await request('/api/v1/health');const data=(await h.json()).data;
 if(!data || data.checks?.supabase?.status!=='ok' || data.checks?.redis?.status!=='ok')throw Error('DB/Redis gate failed');
 if(phase==='cutover' && (data.status!=='healthy'||data.checks?.waha?.status!=='ok'))throw Error('Full health gate failed');
 for(const [path,want] of [['/',307],['/login',200],['/api/v1/integrations/calendar',401],['/api/v1/auth/realtime-token',401],['/api/v1/settings/followup',401]])if((await request(path)).status!==want)throw Error('Critical route gate failed');
})().catch(()=>process.exit(1));
JS
    then healthy=1; break; fi
    sleep 3
  done
  [[ $healthy == 1 ]]
  trap - ERR INT TERM
  echo "Production image gate passed ($phase, $revision). Protected snapshot: $snapshot"
  [[ $phase != staging ]] || echo 'Staging validates DB/Redis/routes; WAHA remains disabled. Auth/Storage/Realtime/TLS acceptance remains separate.'
  exec 9>&-
}
if [[ ${1:-} == --production-images ]]; then
  set -E
  production_images "$@"
  exit 0
fi

COMPOSE="-f docker-compose.prod.yml -f docker-compose.local.yml"
BUILD="-f docker-compose.prod.yml -f docker-compose.build.yml"
APP_PORT="${APP_PORT:-$(awk -F= '$1 == "APP_PORT" { sub(/^[^=]*=/, ""); gsub(/[" \r]/, ""); print; exit }' .env 2>/dev/null)}"
APP_PORT="${APP_PORT:-3000}"
REUSE_RUNNING_IMAGE=0
if [ "${1:-}" = "--reuse-running-image" ]; then
  REUSE_RUNNING_IMAGE=1
elif [ "$#" -gt 0 ]; then
  echo "Uso: $0 [--reuse-running-image]" >&2
  exit 2
fi
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
if [ "$REUSE_RUNNING_IMAGE" = 1 ]; then
  [ -n "$CURRENT" ] || { echo "  ✖ sem imagem válida do app em execução para reutilizar" >&2; exit 1; }
  docker tag "$CURRENT" "$APP_IMAGE_REF"
  echo "  usando imagem já saudável; nenhuma alteração de código será publicada"
else
  docker compose $BUILD build app
fi

step "3/5 Deploy"
if [ "$REUSE_RUNNING_IMAGE" = 1 ]; then
  docker compose $COMPOSE up -d --no-build --no-deps app
else
  docker compose $COMPOSE up -d --no-build app
fi

step "4/5 Health gate"
ok=0
for i in $(seq 1 30); do
  H=$(curl -s --max-time 5 "http://localhost:${APP_PORT}/api/v1/health" || true)
  if echo "$H" | grep -q '"status":"healthy"'; then ok=1; break; fi
  sleep 3
done
[ "$ok" = 1 ] && echo "  ✓ /api/v1/health saudável" || echo "  ✖ health não ficou saudável em 90s"

# Sanity de rotas críticas: cada uma deve devolver o código esperado.
if [ "$ok" = 1 ]; then
  while read -r path want; do
    got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:${APP_PORT}${path}" || echo 000)
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
  if [ "$REUSE_RUNNING_IMAGE" = 1 ]; then
    docker compose $COMPOSE up -d --no-build --no-deps app
  else
    docker compose $COMPOSE up -d --no-build app
  fi
  echo "  Rollback aplicado ($ROLLBACK_REF -> $APP_IMAGE_REF; imagem anterior no ar)."
  echo "  Investigue a causa antes de tentar de novo."
  echo "  Se a mudança for arriscada por natureza, PARE e envie para avaliação humana."
else
  echo "  ✖ SEM imagem de rollback ($ROLLBACK_REF) — INTERVENÇÃO HUMANA NECESSÁRIA."
fi
exit 1
