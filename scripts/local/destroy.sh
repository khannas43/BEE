#!/usr/bin/env bash
# npm run local:destroy — remove this project's containers and its database volume.
# Not routine: use local:reset for app data. Requires --yes or a typed confirmation.
source "$(dirname "$0")/lib.sh"

if [[ "${1:-}" != "--yes" ]]; then
  printf 'This deletes the %s containers and volume %s_pgdata (app and Keycloak data).\nType "destroy %s" to continue: ' "$BEE_COMPOSE_PROJECT" "$BEE_COMPOSE_PROJECT" "$BEE_COMPOSE_PROJECT"
  read -r answer
  [[ "$answer" == "destroy $BEE_COMPOSE_PROJECT" ]] || die "not confirmed; nothing deleted" 2
fi
bash "$ROOT/scripts/local/down.sh"
compose down -v --remove-orphans >/dev/null 2>&1
log "destroyed containers and volume ${BEE_COMPOSE_PROJECT}_pgdata"
