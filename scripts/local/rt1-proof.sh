#!/usr/bin/env bash
# npm run local:rt1 — executable proof of RT1 (ACCEPTANCE_MAPPING.md, owner WP03.2).
# Twice from clean: destroy this project's volume, up, seed, check, targeted reset, check.
# Then seed idempotency, reset refusal guards, a warm restart, and a stop.
# Writes docs/wp03/RT1_PROOF.md. Only the bee-local project's own containers and volume are removed.
source "$(dirname "$0")/lib.sh"

[[ "${1:-}" == "--allow-destroy" && "$#" == 1 ]] || die "RT1 deletes the bee-local app and Keycloak volume twice. Run npm run local:rt1 -- --allow-destroy after confirming no local data must be kept." 2

S="$ROOT/scripts/local"
OUT="$ROOT/docs/wp03/RT1_PROOF.md"
P="$RUN_DIR/rt1"; rm -rf "$P"; mkdir -p "$P"
require_docker
agents_before="$(shasum -a 256 "$ROOT/AGENTS.md" | cut -c1-16)"
T0=$(now_ms)

counts() { psql_app -F / -c "SELECT (SELECT count(*) FROM app.organisation), (SELECT count(*) FROM app.user_account), (SELECT count(*) FROM app.organisation_membership), (SELECT count(*) FROM app.role_assignment), (SELECT count(*) FROM app.master_fee_rule), (SELECT count(*) FROM app.master_rating_formula), (SELECT count(*) FROM app.seed_run)"; }
step() { log "RT1: $*"; }

for run in 1 2; do
  step "run $run: clean"
  bash "$S/destroy.sh" --yes
  step "run $run: up"
  bash "$S/up.sh" | tee "$P/up-$run.log"
  cp "$RUN_DIR/startup.json" "$P/startup-$run.json"
  bash "$S/seed.sh" | tee "$P/seed-$run.log"
  bash "$S/check.sh" > "$P/check-$run.txt" || { cat "$P/check-$run.txt"; die "run $run: local:check failed"; }
  cp "$RUN_DIR/check.json" "$P/check-$run.json"; cp "$RUN_DIR/memory.json" "$P/memory-$run.json"
  tail -1 "$P/check-$run.txt"
  step "run $run: targeted reset"
  bash "$S/reset.sh" | tee "$P/reset-$run.log"
  bash "$S/check.sh" > "$P/check-$run-after-reset.txt" || { cat "$P/check-$run-after-reset.txt"; die "run $run: check after reset failed"; }
  tail -1 "$P/check-$run-after-reset.txt"
done

step "seed idempotency"
c1="$(counts)"; bash "$S/seed.sh" >/dev/null; bash "$S/seed.sh" >/dev/null; c2="$(counts)"
[[ "$c1" == "$c2" ]] || die "seed is not idempotent ($c1 -> $c2)"
echo "$c1 -> $c2" > "$P/idempotency.txt"

step "reset refusal guards"
: > "$P/guards.txt"
guard() { # label, env assignment
  local rc=0 out
  out="$(env "$2" bash "$S/reset.sh" 2>&1)" || rc=$?
  printf '%s|%s|%s|%s\n' "$1" "$2" "$rc" "$(grep -m1 REFUSED <<<"$out" | tr '|' '/')" >> "$P/guards.txt"
  [[ "$rc" == 2 ]] || die "guard '$1' did not refuse (exit $rc)"
}
fp_before="$(psql_super -d keycloak -c 'SELECT count(*) FROM user_entity')/$(counts)"
guard "target the keycloak database" BEE_APP_DB=keycloak
guard "run as the superuser" BEE_APP_DB_USER=bee_super
guard "point at Homebrew PostgreSQL 5432" BEE_PG_PORT=5432
guard "point at the other stack's 5433" BEE_PG_PORT=5433
guard "foreign compose project" BEE_COMPOSE_PROJECT=analytics
fp_after="$(psql_super -d keycloak -c 'SELECT count(*) FROM user_entity')/$(counts)"
[[ "$fp_before" == "$fp_after" ]] || die "a refused reset changed data ($fp_before -> $fp_after)"
rc=0; echo "no" | bash "$S/destroy.sh" >/dev/null 2>&1 || rc=$?
[[ "$rc" == 2 ]] && container_running bee-local-postgres || die "destroy without confirmation was not refused"
echo "destroy-unconfirmed|exit $rc|containers still running" > "$P/destroy-guard.txt"

step "warm restart (data kept)"
bash "$S/down.sh" >/dev/null
bash "$S/up.sh" | tee "$P/up-warm.log"
cp "$RUN_DIR/startup.json" "$P/startup-warm.json"
bash "$S/check.sh" > "$P/check-warm.txt" || { cat "$P/check-warm.txt"; die "warm check failed"; }
cp "$RUN_DIR/memory.json" "$P/memory-warm.json"
bash "$S/health.sh" > "$P/health.txt"
tail -1 "$P/check-warm.txt"

# ---- facts for the report (best effort; a missing fact must not void the proof)
set +e
v_pg="$(psql_super -d postgres -c 'SHOW server_version')"
v_kc="$(docker exec bee-local-keycloak /opt/keycloak/bin/kc.sh --version 2>/dev/null | awk '/Keycloak/{print $2; exit}')"
v_boot="$(awk -F'[<>]' '/<artifactId>spring-boot-starter-parent/{getline; print $3; exit}' "$ROOT/backend/pom.xml")"
v_java="$("$(java17_home)/bin/java" -version 2>&1 | awk -F'"' '/version/{print $2}')"
v_flyway="$(unzip -Z1 "$API_JAR" 2>/dev/null | awk -F'flyway-core-' 'NF>1{sub(/\.jar$/,"",$2); print $2; exit}')"
v_next="$(node -p 'require("next/package.json").version')"
v_node="$(node -v)"
v_docker="$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
img_pg="$(docker image inspect postgres:16-alpine --format '{{.Size}}' | awk '{printf "%.0f", $1/1048576}')"
img_kc="$(docker image inspect quay.io/keycloak/keycloak:26.7.4 --format '{{.Size}}' | awk '{printf "%.0f", $1/1048576}')"
vol="$(docker exec bee-local-postgres du -sm /var/lib/postgresql/data 2>/dev/null | awk '{print $1 " MB"}')"
jar_mb="$(du -m "$API_JAR" | cut -f1)"
hw="$(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores, $(( $(sysctl -n hw.memsize) / 1073741824 )) GB RAM"
set -e

bash "$S/down.sh" >/dev/null
agents_after="$(shasum -a 256 "$ROOT/AGENTS.md" | cut -c1-16)"
[[ "$agents_before" == "$agents_after" ]] || die "AGENTS.md changed during the proof"
elapsed_s=$(( ($(now_ms) - T0) / 1000 ))

sj() { jq -r ".$2" "$P/startup-$1.json"; }
mj() { jq -r ".$2" "$P/memory-$1.json"; }
secs() { awk -v m="$1" 'BEGIN{printf "%.1f s", m/1000}'; }
checks_n="$(jq -r '"\(.passed) passed, \(.failed) failed"' "$P/check-2.json")"

mkdir -p "$(dirname "$OUT")"
{
cat <<MD
# RT1 proof: local runtime on this MacBook

Generated by \`npm run local:rt1 -- --allow-destroy\` (\`scripts/local/rt1-proof.sh\`) on $(date '+%-d %B %Y at %H:%M %Z'). Re-run the command to regenerate. RT1 is the executable proof of [ADR-001](../wp01/ADR-001-local-runtime.md), owned by WP03.2 in [ACCEPTANCE_MAPPING.md](../wp01/ACCEPTANCE_MAPPING.md). This file is evidence for review; it does not accept any work package.

Result: **passed on this machine.** Both clean runs passed every \`local:check\` item before and after the targeted reset; seed is idempotent; every refusal guard refused; \`AGENTS.md\` was unchanged. Whole proof took ${elapsed_s} s.

Machine: ${hw}; Docker ${v_docker} (Rancher Desktop).

## Versions

| Component | Version |
| --- | --- |
| PostgreSQL (\`postgres:16-alpine\`) | ${v_pg} |
| Keycloak (\`quay.io/keycloak/keycloak:26.7.4\`, dev mode) | ${v_kc} |
| Spring Boot / Java | ${v_boot} / ${v_java} |
| Flyway | ${v_flyway} |
| Next.js / Node | ${v_next} / ${v_node} |

## Ports (measured)

All four ADR-001 D-RT7 ports were free of other owners, bound to \`127.0.0.1\` only, and owned by this project's components (\`local:check\` items \`port.*\`).

| Component | Port | Listener |
| --- | ---: | --- |
| Next.js web and server routes | ${BEE_WEB_PORT} | \`next dev\` |
| Spring API | ${BEE_API_PORT} | \`java -jar backend/target/bee-api.jar\` |
| Keycloak | ${BEE_KC_PORT} | container \`bee-local-keycloak\` |
| PostgreSQL | ${BEE_PG_PORT} | container \`bee-local-postgres\` |

## Startup (measured, from \`local:up\`)

| Run | PostgreSQL healthy | Keycloak realm | Spring healthy | Web route answering | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
MD
for r in 1 2 warm; do
  label="Clean run $r"; [[ "$r" == warm ]] && label="Warm restart (data kept)"
  echo "| ${label} | $(secs "$(sj "$r" postgres_ms)") | $(secs "$(sj "$r" keycloak_ms)") | $(secs "$(sj "$r" api_ms)") | $(secs "$(sj "$r" web_ms)") | $(secs "$(sj "$r" total_ms)") |"
done
cat <<MD

Clean runs include creating the database volume and Keycloak's first schema build and realm import. The Spring time includes a Maven build only when sources changed. "Web route answering" is \`next dev\` start plus the first compile of \`/api/runtime/health\`.

## Memory (measured with the runtime idle after \`local:check\`)

Containers from \`docker stats\`; Spring and \`next dev\` as the resident set size of their process trees.

| Component | Budget (D-RT8) | Clean run 1 | Clean run 2 | Warm |
| --- | ---: | ---: | ---: | ---: |
| PostgreSQL container | 300 MB | $(mj 1 postgres_mb) MB | $(mj 2 postgres_mb) MB | $(mj warm postgres_mb) MB |
| Keycloak container | 1,000 MB | $(mj 1 keycloak_mb) MB | $(mj 2 keycloak_mb) MB | $(mj warm keycloak_mb) MB |
| Spring API (heap \`${BEE_API_HEAP}\`) | 800 MB | $(mj 1 api_mb) MB | $(mj 2 api_mb) MB | $(mj warm api_mb) MB |
| \`next dev\` | 1,500 MB | $(mj 1 web_mb) MB | $(mj 2 web_mb) MB | $(mj warm web_mb) MB |
| **Total** | **3,600 MB** | **$(mj 1 total_mb) MB** | **$(mj 2 total_mb) MB** | **$(mj warm total_mb) MB** |

These are idle figures with one route compiled. \`next dev\` grows as more pages compile, and Keycloak grows under login load; WP03 should re-measure once the slice screens run.

Disk: images postgres ${img_pg} MB and Keycloak ${img_kc} MB; volume \`${BEE_COMPOSE_PROJECT}_pgdata\` ${vol:-unknown}; API jar ${jar_mb} MB.

## Commands

| Command | What it does |
| --- | --- |
| \`npm run local:up\` | Refuse if a port has another owner or Docker is down; start PostgreSQL, Keycloak, Spring (building the jar if stale) and \`next dev\`; wait for each health signal; restore \`AGENTS.md\` if \`next dev\` rewrote it. Idempotent. |
| \`npm run local:health\` | One line per component: PostgreSQL ready, realm discovery, Spring health with database, web server-to-API route. |
| \`npm run local:seed\` | Load \`local/seed/seed.sql\` as \`bee_app\`. Idempotent upserts. |
| \`npm run local:reset\` | Targeted app-data reset: guards, stop Spring, drop and recreate schema \`app\` in \`bee_app\` as \`bee_app\`, restart Spring (Flyway migrates), seed, and confirm the Keycloak database is unchanged. |
| \`npm run local:reset:identity\` | Re-import the Keycloak realm; Spring data untouched. |
| \`npm run local:check\` | $(jq '.checks | length' "$P/check-2.json") pass/fail items; writes \`.local/run/check.json\`. |
| \`npm run local:down\` | Stop \`next dev\`, Spring and the containers; keep the volume. |
| \`npm run local:destroy\` | Remove this project's containers and volume after typed confirmation. Not routine. |
| \`npm run local:rt1 -- --allow-destroy\` | Explicit opt-in for this proof. It destroys and recreates only the \`${BEE_COMPOSE_PROJECT}\` project's volume twice, and leaves the runtime stopped. |

## \`local:check\` items (clean run 2: ${checks_n})

| Item | Result | Detail |
| --- | --- | --- |
MD
jq -r '.checks[] | "| `\(.id)` | \(.result) | \(.detail | gsub("\\|"; "/")) |"' "$P/check-2.json"
cat <<MD

## Targeted reset and guards

Each clean run ended with \`local:reset\` followed by a full \`local:check\` that passed; the reset confirmed the Keycloak realm, user and credential counts were unchanged. Seed run three times in a row: organisations/accounts/memberships/roles/fee rules/formulas/seed markers $(cat "$P/idempotency.txt").

Reset refused, exit code 2, with no data changed (Keycloak users / app counts \`${fp_after}\` before and after):

| Attempt | Override | Refusal |
| --- | --- | --- |
MD
while IFS='|' read -r label env rc msg; do echo "| ${label} | \`${env}\` | ${msg#REFUSED: } |"; done < "$P/guards.txt"
cat <<MD

\`local:destroy\` without confirmation exited 2 and left the containers running.

## Authority boundary shown by the checks

- Keycloak issues the token; Spring maps \`sub\` to \`app.user_account\` and reads role, scope and organisation from its own tables. \`/api/me\` reports \`"authority": "spring-database"\`.
- The check client adds a misleading \`organisation\` claim ("PixelCert Agency"). For \`nova.applicant\` Spring returns NOVA from the database and echoes the claim only under \`ignoredTokenClaims\`.
- A valid Keycloak login is not enough: \`no.account\` (no Spring account), \`inactive.role\` (assignment inactive) and \`role.mismatch\` (token role not assigned in Spring) are all denied with 403.
- Every route other than \`GET /api/me\` and health is \`denyAll\`, including writes. No capacities from the screen matrix are loaded; the 540 mismatches remain policy-review proposals.
- The browser calls only Next.js. \`/api/runtime/me\` does not forward a browser \`Authorization\` header, so Spring answers 401 until the WP02.1 session flow exists.

## Not covered by RT1

- Login through the browser, sessions and cookies (WP02.1).
- The model workflow and approved fee/rating rules. The seed holds a synthetic fee rule and formula version \`0-unverified\` as provisional metadata; no rating computation or official fee is claimed.
- Any adapter, migration or release work (WP12–WP14).
MD
} > "$OUT"
log "RT1 proof written to ${OUT#$ROOT/} in ${elapsed_s} s"
