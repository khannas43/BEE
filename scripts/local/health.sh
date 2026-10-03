#!/usr/bin/env bash
# npm run local:health — one line per component; exit 1 if any is down.
BEE_RUN_LOCK=skip source "$(dirname "$0")/lib.sh"

fails=0
report() { printf '%-9s %-4s %s\n' "$1" "$2" "$3"; [[ "$2" == "UP" ]] || fails=$((fails + 1)); }

if container_running bee-local-postgres && docker exec bee-local-postgres pg_isready -q -U bee_super -d postgres; then
  report postgres UP "127.0.0.1:${BEE_PG_PORT}"
else report postgres DOWN "127.0.0.1:${BEE_PG_PORT}"; fi

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${KC_ISSUER}/.well-known/openid-configuration" || true)"
[[ "$code" == 200 ]] && report keycloak UP "${KC_ISSUER}" || report keycloak DOWN "realm discovery HTTP ${code}"

body="$(curl -s --max-time 5 "http://127.0.0.1:${BEE_API_PORT}/actuator/health" || true)"
[[ "$(jq -r '.status // empty' <<<"$body" 2>/dev/null)" == "UP" ]] && report api UP "db=$(jq -r '.components.db.status // "?"' <<<"$body")" || report api DOWN "${body:-no response}"

body="$(curl -s --max-time 10 "http://127.0.0.1:${BEE_WEB_PORT}/api/runtime/health" || true)"
[[ "$(jq -r '.api // empty' <<<"$body" 2>/dev/null)" == "UP" ]] && report web UP "server-to-API path: api=UP" || report web DOWN "${body:-no response}"

exit $(( fails > 0 ))
