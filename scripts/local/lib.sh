# Shared helpers for the local runtime commands (ADR-001 §3). Sourced, not run.
# shellcheck shell=bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../../local/local.env
source "$ROOT/local/local.env"

RUN_DIR="$ROOT/.local/run"
LOG_DIR="$ROOT/.local/logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"
# Structured request logs (docs/wp03/request-log.schema.json): Spring api-requests.jsonl, Next.js web-requests.jsonl.
export BEE_LOG_DIR="$LOG_DIR"
# WP06.1a: git-ignored content-addressed document store (ADR-001 D-RT6)
export BEE_DOCUMENTS_STORE="${BEE_DOCUMENTS_STORE:-$ROOT/.local/documents}"
export BEE_DOCUMENTS_MAX_BYTES="${BEE_DOCUMENTS_MAX_BYTES:-5242880}"
mkdir -p "$BEE_DOCUMENTS_STORE"

API_JAR="$ROOT/backend/target/bee-api.jar"
API_PID="$RUN_DIR/api.pid"
WEB_PID="$RUN_DIR/web.pid"
KC_ISSUER="http://127.0.0.1:${BEE_KC_PORT}/realms/${BEE_REALM}"

log() { printf '%s %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }

# One local run at a time: check.sh tears down every disposable twin when it starts, so an overlapping
# run deletes the identities the other is signed in as. The lock belongs to the outermost shell (pid plus
# start time, so a reused pid is not mistaken for the owner); nested scripts inherit it, and a lock whose
# owner has exited is taken over. Set BEE_RUN_LOCK=skip before sourcing for read-only commands.
RUN_LOCK="$RUN_DIR/run.lock"
pid_started() { ps -o lstart= -p "$1" 2>/dev/null | tr -s ' '; }
acquire_run_lock() {
  [[ "${BEE_RUN_LOCK:-}" == skip ]] && return 0
  [[ -n "${BEE_RUN_LOCK_OWNER:-}" && "$(cat "$RUN_LOCK/owner" 2>/dev/null)" == "$BEE_RUN_LOCK_OWNER" ]] && return 0
  local me; me="$$ $(pid_started $$)"
  if ! mkdir "$RUN_LOCK" 2>/dev/null; then
    local owner pid; owner="$(cat "$RUN_LOCK/owner" 2>/dev/null || true)"; pid="${owner%% *}"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && [[ "$owner" == "$pid $(pid_started "$pid")" ]]; then
      printf 'ERROR: another local run holds %s (pid %s: %s)\n' "$RUN_LOCK" "$pid" "$(ps -o command= -p "$pid" | cut -c1-100)" >&2; exit 1
    fi
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      log "removed stale run lock at $RUN_LOCK (owner pid $pid is not running)"
    else
      log "removed stale run lock at $RUN_LOCK (owner is no longer valid)"
    fi
    rm -rf "$RUN_LOCK"; mkdir "$RUN_LOCK" || { echo "ERROR: could not take $RUN_LOCK" >&2; exit 1; }
  fi
  printf '%s\n' "$me" > "$RUN_LOCK/owner"
  export BEE_RUN_LOCK_OWNER="$me"
}
acquire_run_lock

# One row per component: name|UP|detail or name|DOWN|detail (used by health.sh and check.sh preflight).
runtime_health_rows() {
  if container_running bee-local-postgres && docker exec bee-local-postgres pg_isready -q -U bee_super -d postgres 2>/dev/null; then
    printf 'postgres|UP|127.0.0.1:%s\n' "$BEE_PG_PORT"
  else
    printf 'postgres|DOWN|127.0.0.1:%s\n' "$BEE_PG_PORT"
  fi
  local code body status db
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${KC_ISSUER}/.well-known/openid-configuration" || true)"
  if [[ "$code" == 200 ]]; then
    printf 'keycloak|UP|%s\n' "$KC_ISSUER"
  else
    printf 'keycloak|DOWN|realm discovery HTTP %s\n' "${code:-none}"
  fi
  body="$(curl -s --max-time 5 "http://127.0.0.1:${BEE_API_PORT}/actuator/health" || true)"
  status="$(jq -r '.status // empty' <<<"$body" 2>/dev/null)"
  if [[ "$status" == UP ]]; then
    db="$(jq -r '.components.db.status // "?"' <<<"$body" 2>/dev/null)"
    printf 'api|UP|db=%s\n' "$db"
  else
    printf 'api|DOWN|%s\n' "${body:-no response}"
  fi
  body="$(curl -s --max-time 10 "http://127.0.0.1:${BEE_WEB_PORT}/api/runtime/health" || true)"
  if [[ "$(jq -r '.api // empty' <<<"$body" 2>/dev/null)" == UP ]]; then
    printf 'web|UP|server-to-API path: api=UP\n'
  else
    printf 'web|DOWN|%s\n' "${body:-no response}"
  fi
}

runtime_health_down() {
  local name status detail
  while IFS='|' read -r name status detail; do
    [[ "$status" == DOWN ]] && printf '%s (%s)\n' "$name" "$detail"
  done < <(runtime_health_rows)
}

# Median of positive integers (bash 3.2+).
memory_median_mb() {
  local -a vals=("$@")
  ((${#vals[@]})) || { echo 0; return; }
  local sorted line n mid
  sorted="$(printf '%s\n' "${vals[@]}" | sort -n)"
  n="$(wc -l <<<"$sorted" | tr -d ' ')"
  mid=$(( (n + 1) / 2 ))
  line="$(sed -n "${mid}p" <<<"$sorted")"
  echo "${line:-0}"
}

java17_home() { /usr/libexec/java_home -v 17 2>/dev/null || { echo "Java 17 is required (ADR-001 D-RT1)" >&2; return 1; }; }

now_ms() { node -e 'process.stdout.write(String(Date.now()))'; }

compose() { docker compose -p "$BEE_COMPOSE_PROJECT" -f "$ROOT/local/compose.yaml" "$@"; }

require_docker() { docker info >/dev/null 2>&1 || die "Docker is not running"; }

# detach PIDFILE CMD...: run CMD in its own session so it outlives the calling shell,
# writing CMD's own pid (exec keeps it) rather than a wrapper's.
detach() {
  perl -MPOSIX -e '$f = shift; $SIG{HUP} = "IGNORE"; POSIX::setsid();
    open(my $h, ">", $f) or die "pid file: $!"; print $h $$; close $h;
    exec @ARGV or die "exec: $!"' "$@" &
  local i
  for i in $(seq 1 50); do [[ -s "$1" ]] && return 0; sleep 0.1; done
  die "could not start: ${*:2}"
}

pid_alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

port_listener() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }

port_owner_desc() {
  local pid; pid="$(port_listener "$1")"
  [[ -z "$pid" ]] && { echo "free"; return; }
  echo "pid $pid ($(ps -o comm= -p "$pid" 2>/dev/null | xargs basename 2>/dev/null))"
}

container_running() { [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null || echo false)" == "true" ]]; }

# A port may be used only by this project's own component.
assert_port_ours() {
  local port="$1" kind="$2" pid
  pid="$(port_listener "$port")"
  [[ -z "$pid" ]] && return 0
  case "$kind" in
    postgres) container_running bee-local-postgres && [[ "$(docker port bee-local-postgres 5432/tcp 2>/dev/null)" == "127.0.0.1:${port}" ]] && return 0 ;;
    keycloak) container_running bee-local-keycloak && [[ "$(docker port bee-local-keycloak 8080/tcp 2>/dev/null)" == "127.0.0.1:${port}" ]] && return 0 ;;
    api) pid_alive "$API_PID" && descendant_of "$pid" "$(cat "$API_PID")" && return 0
      [[ "${BEE_APP_MODE:-}" == container ]] && container_running bee-local-api && return 0 ;;
    web) pid_alive "$WEB_PID" && descendant_of "$pid" "$(cat "$WEB_PID")" && return 0
      [[ "${BEE_APP_MODE:-}" == container ]] && container_running bee-local-web && return 0 ;;
  esac
  die "port $port ($kind) is already used by $(port_owner_desc "$port"); free it or override BEE_*_PORT" 3
}

descendant_of() {
  local p="$1" root="$2"
  while [[ -n "$p" && "$p" != "1" ]]; do
    [[ "$p" == "$root" ]] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
  done
  return 1
}

wait_http() { # url, timeout seconds, [expected code], [container or pid file that must stay alive]
  local url="$1" timeout="$2" expect="${3:-200}" watch="${4:-}" start code
  start=$(date +%s)
  while true; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)"
    [[ "$code" == "$expect" ]] && return 0
    if [[ -n "$watch" ]]; then
      if [[ -f "$watch" ]]; then pid_alive "$watch" || { echo "process exited while waiting for $url" >&2; return 1; }
      else container_running "$watch" || { echo "container $watch exited while waiting for $url" >&2; return 1; }; fi
    fi
    (( $(date +%s) - start >= timeout )) && { echo "timeout after ${timeout}s waiting for $url (last $code)" >&2; return 1; }
    sleep 1
  done
}

wait_container_healthy() {
  local name="$1" timeout="$2" start
  start=$(date +%s)
  until [[ "$(docker inspect -f '{{.State.Health.Status}}' "$name" 2>/dev/null)" == "healthy" ]]; do
    (( $(date +%s) - start >= timeout )) && { echo "timeout waiting for $name to be healthy" >&2; return 1; }
    sleep 1
  done
}

tree_pids() {
  local p="$1" c
  echo "$p"
  for c in $(pgrep -P "$p" 2>/dev/null || true); do tree_pids "$c"; done
}

kill_tree() {
  local root="$1" pids p
  pids="$(tree_pids "$root" | sort -u)"
  for p in $pids; do kill "$p" 2>/dev/null || true; done
  for _ in $(seq 1 20); do
    local alive=0
    for p in $pids; do kill -0 "$p" 2>/dev/null && alive=1; done
    (( alive == 0 )) && return 0
    sleep 0.5
  done
  for p in $pids; do kill -9 "$p" 2>/dev/null || true; done
}

tree_rss_kb() {
  local total=0 p r
  for p in $(tree_pids "$1" | sort -u); do
    r="$(ps -o rss= -p "$p" 2>/dev/null | tr -d ' ')"
    [[ -n "$r" ]] && total=$((total + r))
  done
  echo "$total"
}

psql_app() { docker exec -i -e PGPASSWORD="$BEE_APP_DB_PASSWORD" bee-local-postgres psql -h 127.0.0.1 -U "$BEE_APP_DB_USER" -d "$BEE_APP_DB" -v ON_ERROR_STOP=1 -qtA "$@"; }
psql_super() { docker exec -i -e PGPASSWORD="$BEE_PG_SUPER_PASSWORD" bee-local-postgres psql -h 127.0.0.1 -U bee_super -v ON_ERROR_STOP=1 -qtA "$@"; }

# ---- AGENTS.md guard: next dev may rewrite it (see node_modules/next/dist/server/lib/generate-agent-files.js)
agents_snapshot() {
  cp "$ROOT/AGENTS.md" "$RUN_DIR/AGENTS.md.snapshot"
  [[ -e "$ROOT/CLAUDE.md" ]] && echo present > "$RUN_DIR/CLAUDE.md.state" || echo absent > "$RUN_DIR/CLAUDE.md.state"
}
agents_restore() {
  [[ -f "$RUN_DIR/AGENTS.md.snapshot" ]] || return 0
  if ! cmp -s "$RUN_DIR/AGENTS.md.snapshot" "$ROOT/AGENTS.md"; then
    cp "$RUN_DIR/AGENTS.md.snapshot" "$ROOT/AGENTS.md"
    log "restored AGENTS.md (next dev had rewritten it)"
  fi
  if [[ "$(cat "$RUN_DIR/CLAUDE.md.state" 2>/dev/null)" == "absent" && -e "$ROOT/CLAUDE.md" ]]; then
    rm -f "$ROOT/CLAUDE.md"
    log "removed CLAUDE.md created by next dev"
  fi
}

# ---- component starts, shared by up and reset
build_api_if_needed() {
  if [[ ! -f "$API_JAR" ]] || [[ -n "$(find "$ROOT/backend/src" "$ROOT/backend/pom.xml" -newer "$API_JAR" -type f 2>/dev/null | head -1)" ]]; then
    log "building API jar (Java 17, Maven)"
    JAVA_HOME="$(java17_home)" mvn -q -B -f "$ROOT/backend/pom.xml" -DskipTests package >"$LOG_DIR/api-build.log" 2>&1 || { tail -30 "$LOG_DIR/api-build.log" >&2; die "API build failed"; }
  fi
}

start_api() {
  if pid_alive "$API_PID"; then log "api already running (pid $(cat "$API_PID"))"; return 0; fi
  assert_port_ours "$BEE_API_PORT" api
  build_api_if_needed
  local java; java="$(java17_home)/bin/java"
  # shellcheck disable=SC2086
  rm -f "$API_PID"
  detach "$API_PID" "$java" $BEE_API_HEAP -jar "$API_JAR" >"$LOG_DIR/api.log" 2>&1
  wait_http "http://127.0.0.1:${BEE_API_PORT}/actuator/health" 90 200 "$API_PID" || { tail -40 "$LOG_DIR/api.log" >&2; die "API did not become healthy"; }
  log "api up on 127.0.0.1:${BEE_API_PORT} (pid $(cat "$API_PID"))"
}

stop_api() {
  if pid_alive "$API_PID"; then kill_tree "$(cat "$API_PID")"; log "api stopped"; fi
  rm -f "$API_PID"
}
