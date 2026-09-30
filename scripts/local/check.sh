#!/usr/bin/env bash
# npm run local:check — pass/fail report for the running local runtime (ADR-001 §3).
# Writes .local/run/check.json; exits 1 if any check fails.
source "$(dirname "$0")/lib.sh"
set +e  # a failing probe must be reported as FAIL, not abort the run

RESULTS="$RUN_DIR/check.results"
: > "$RESULTS"
pass=0; fail=0
check() { # id, ok(0/1), detail
  local mark=PASS
  if [[ "$2" == 1 ]]; then pass=$((pass + 1)); else fail=$((fail + 1)); mark=FAIL; fi
  printf '%-4s %-34s %s\n' "$mark" "$1" "$3"
  jq -nc --arg id "$1" --arg r "$mark" --arg d "$3" '{id:$id,result:$r,detail:$d}' >> "$RESULTS"
}
ok() { if "$@"; then echo 1; else echo 0; fi; }

API="http://127.0.0.1:${BEE_API_PORT}"
WEB="http://127.0.0.1:${BEE_WEB_PORT}"

# ---- ports: listening, bound to loopback, owned by this project
for spec in "postgres:$BEE_PG_PORT" "keycloak:$BEE_KC_PORT" "api:$BEE_API_PORT" "web:$BEE_WEB_PORT"; do
  kind="${spec%%:*}"; port="${spec##*:}"
  pid="$(port_listener "$port")"
  owned=0
  if [[ -n "$pid" ]]; then (assert_port_ours "$port" "$kind" >/dev/null 2>&1) && owned=1; fi
  wide="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 && $9 !~ /^127\.0\.0\.1:/ && $9 !~ /^\[::1\]:/' | head -1)"
  check "port.$kind" "$(ok test "$owned" = 1 -a -z "$wide")" "127.0.0.1:$port $(port_owner_desc "$port")${wide:+ ALSO NON-LOOPBACK}"
done

# ---- Keycloak realm discovery
disc="$(curl -s --max-time 5 "${KC_ISSUER}/.well-known/openid-configuration" || true)"
issuer="$(jq -r '.issuer // empty' <<<"$disc" 2>/dev/null)"
check "keycloak.realm-discovery" "$(ok test "$issuer" = "$KC_ISSUER")" "issuer=${issuer:-none}"

# ---- Spring health, including database
h="$(curl -s --max-time 5 "$API/actuator/health" || true)"
check "api.health" "$(ok test "$(jq -r '.status // empty' <<<"$h" 2>/dev/null)" = UP)" "status=$(jq -r '.status // "none"' <<<"$h" 2>/dev/null)"
check "api.health.db" "$(ok test "$(jq -r '.components.db.status // empty' <<<"$h" 2>/dev/null)" = UP)" "db=$(jq -r '.components.db.status // "none"' <<<"$h" 2>/dev/null)"
code="$(curl -s -o /dev/null -w '%{http_code}' "$API/actuator/env")"
check "api.actuator-minimal" "$(ok test "$code" != 200)" "/actuator/env HTTP $code (only health is exposed)"

# ---- database: migration version, seed counts, isolation
fly="$(psql_app -F ' ' -c "SELECT max(version::int), bool_and(success) FROM app.flyway_schema_history WHERE version IS NOT NULL" 2>/dev/null || true)"
read -r fv fok <<<"$fly"
expected_v="$(find "$ROOT/backend/src/main/resources/db/migration" -name 'V*__*.sql' | sed -E 's#.*/V([0-9]+)__.*#\1#' | sort -n | tail -1)"
check "db.migration-version" "$(ok test "${fv:-x}" = "$expected_v" -a "${fok:-f}" = t)" "flyway V${fv:-none} (expected V$expected_v), success=${fok:-?}"

want="$(node "$ROOT/local/generate-fixtures.cjs" --counts)"
got="$(psql_app -F ' ' -c "SELECT (SELECT count(*) FROM app.organisation), (SELECT count(*) FROM app.user_account), (SELECT count(*) FROM app.organisation_membership), (SELECT count(*) FROM app.role_assignment), (SELECT count(*) FROM app.role_assignment WHERE active), (SELECT count(*) FROM app.assignment)" 2>/dev/null || true)"
read -r g_org g_usr g_mem g_role g_act g_asg <<<"$got"
w="$(jq -r '"\(.organisations) \(.userAccounts) \(.memberships) \(.roleAssignments) \(.activeRoleAssignments)"' <<<"$want")"
check "db.seed-counts" "$(ok test "$g_org $g_usr $g_mem $g_role $g_act" = "$w")" "org/user/membership/role/active = $g_org/$g_usr/$g_mem/$g_role/$g_act (expected ${w// //})"
rule_counts="$(psql_app -F ' ' -c "SELECT (SELECT count(*) FROM app.fee_rule WHERE id='RAC-DEMO' AND category='RAC' AND version='0-unverified' AND amount_inr=1000 AND status='unverified'), (SELECT count(*) FROM app.rating_formula WHERE id='RAC-STAR-DEMO' AND category='RAC' AND version='0-unverified' AND status='unverified' AND definition='{}'::jsonb), (SELECT count(*) FROM app.seed_run WHERE seed_version='rt1-local-v2')" 2>/dev/null || true)"
check "db.provisional-rules" "$(ok test "$rule_counts" = '1 1 1')" "synthetic fee/formula/seed marker = $rule_counts (expected 1 1 1; neither rule approved)"
check "db.no-workflow-data" "$(ok test "${g_asg:-x}" = 0)" "assignment rows=${g_asg:-?} (model workflow not implemented)"
grants="$(psql_app -c "SELECT count(*) FROM app.role_assignment WHERE role NOT IN ('admin','programme','reviewer','director','secretary','finance','helpdesk','auditor','manufacturer','agency','iame','sda','laboratory')" 2>/dev/null || echo x)"
check "db.no-matrix-grants" "$(ok test "$grants" = 0)" "role rows outside the 13 personas=$grants; no capacity grants table exists"
iso="$(docker exec -e PGPASSWORD="$BEE_APP_DB_PASSWORD" bee-local-postgres psql -h 127.0.0.1 -U bee_app -d keycloak -c 'SELECT 1' 2>&1 || true)"
check "db.keycloak-isolated" "$(ok grep -q 'permission denied' <<<"$iso")" "bee_app login to keycloak db: $(grep -o 'permission denied[^"]*' <<<"$iso" | head -1 | cut -c1-60)"

# ---- tokens: Keycloak identifies, Spring decides
token() {
  curl -s --max-time 10 -X POST "${KC_ISSUER}/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=bee-local-check -d "username=$1" -d "password=$BEE_DEV_USER_PASSWORD" | jq -r '.access_token // empty'
}
me() { curl -s -o "$RUN_DIR/me.body" -w '%{http_code}' --max-time 5 -H "Authorization: Bearer $1" "$API/api/me"; }

t_nova="$(token nova.applicant)"
check "token.issued" "$(ok test -n "$t_nova")" "password grant via bee-local-check client"
aud="$(node -e 'const p=JSON.parse(Buffer.from(process.argv[1].split(".")[1],"base64url"));console.log([].concat(p.aud).join(","))' "$t_nova" 2>/dev/null || true)"
check "token.audience" "$(ok grep -q bee-api <<<"$aud")" "aud=$aud"

code="$(me "$t_nova")"; b="$(cat "$RUN_DIR/me.body")"
nova_ok=$(ok test "$code" = 200 \
  -a "$(jq -r '[.organisations[].code] | join(",")' <<<"$b")" = NOVA \
  -a "$(jq -r '[.effectiveRoles[] | "\(.role)/\(.scope)"] | join(",")' <<<"$b")" = manufacturer/own-org \
  -a "$(jq -r '.authority' <<<"$b")" = spring-database)
check "authz.nova-db-scope" "$nova_ok" "HTTP $code orgs=$(jq -c '[.organisations[].code]' <<<"$b" 2>/dev/null) roles=$(jq -c '[.effectiveRoles[] | .role + "/" + .scope]' <<<"$b" 2>/dev/null)"
claim="$(jq -r '.ignoredTokenClaims.organisation // empty' <<<"$b" 2>/dev/null)"
check "authz.token-org-claim-ignored" "$(ok test -n "$claim" -a "$claim" != "$(jq -r '.organisations[0].legalName' <<<"$b")")" "token says '$claim'; Spring used NOVA from its database"

code="$(me "$(token pixel.applicant)")"
check "authz.pixel-db-scope" "$(ok test "$code" = 200 -a "$(jq -r '[.organisations[].code] | join(",")' "$RUN_DIR/me.body")" = PIXEL)" "HTTP $code orgs=$(jq -c '[.organisations[].code]' "$RUN_DIR/me.body" 2>/dev/null)"

for spec in "no.account:no_active_account" "inactive.role:no_effective_role" "role.mismatch:no_effective_role"; do
  u="${spec%%:*}"; want_err="${spec##*:}"
  code="$(me "$(token "$u")")"; err="$(jq -r '.error // empty' "$RUN_DIR/me.body" 2>/dev/null)"
  check "authz.deny.$u" "$(ok test "$code" = 403 -a "$err" = "$want_err")" "HTTP $code error=$err (Keycloak role present, Spring denies)"
done

code="$(curl -s -o /dev/null -w '%{http_code}' "$API/api/me")"
check "authz.no-token-401" "$(ok test "$code" = 401)" "GET /api/me without token: HTTP $code"
forged="${t_nova%.*}.$(printf 'forged' | base64 | tr -d '=' | tr '+/' '-_')"
code="$(me "$forged")"
check "authz.bad-signature-401" "$(ok test "$code" = 401)" "tampered signature: HTTP $code"
code="$(curl -s -o "$RUN_DIR/me.body" -w '%{http_code}' -H "Authorization: Bearer $t_nova" "$API/api/anything")"
check "authz.unknown-route-denied" "$(ok test "$code" = 403 -a "$(jq -r .error "$RUN_DIR/me.body" 2>/dev/null)" = denied_by_default)" "GET /api/anything with valid token: HTTP $code"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $t_nova" "$API/api/me")"
check "authz.write-denied" "$(ok test "$code" = 403)" "POST /api/me with valid token: HTTP $code"
cid="$(curl -s -D - -o /dev/null -H 'X-Correlation-Id: rt1-check-0001' "$API/api/me" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-correlation-id"{print $2}')"
check "api.correlation-id" "$(ok test "$cid" = rt1-check-0001)" "echoed=$cid"

# ---- Next.js server-to-API path
wh="$(curl -s -w '\n%{http_code}' --max-time 15 "$WEB/api/runtime/health" || true)"
check "web.server-to-api-health" "$(ok test "$(tail -1 <<<"$wh")" = 200 -a "$(sed '$d' <<<"$wh" | jq -r .api 2>/dev/null)" = UP)" "GET /api/runtime/health HTTP $(tail -1 <<<"$wh") api=$(sed '$d' <<<"$wh" | jq -r .api 2>/dev/null)"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "Authorization: Bearer $t_nova" "$WEB/api/runtime/me")"
check "web.browser-token-not-forwarded" "$(ok test "$code" = 401)" "GET /api/runtime/me with a browser Authorization header: HTTP $code"

# ---- WP02.1 sign-in through Next.js server routes (scripts/local/auth-check.cjs)
auth_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/auth-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$auth_out"
read -r a_pass a_fail <<<"$(sed -nE 's/^auth checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$auth_out")"
if [[ -z "${a_pass:-}" ]]; then check "auth.run" 0 "auth-check did not complete: $(tail -1 <<<"$auth_out")"
else pass=$((pass + a_pass)); fail=$((fail + a_fail)); fi

# ---- memory against ADR-001 D-RT8 (MB)
mem_mb() { docker stats --no-stream --format '{{.MemUsage}}' "$1" 2>/dev/null | awk '{v=$1; u=v; gsub(/[0-9.]/,"",u); gsub(/[A-Za-z]/,"",v); if(u=="GiB")v*=1024; else if(u=="KiB")v/=1024; printf "%d", v}'; }
pg_mb="$(mem_mb bee-local-postgres)"; kc_mb="$(mem_mb bee-local-keycloak)"
api_mb=0; pid_alive "$API_PID" && api_mb=$(( $(tree_rss_kb "$(cat "$API_PID")") / 1024 ))
web_mb=0; pid_alive "$WEB_PID" && web_mb=$(( $(tree_rss_kb "$(cat "$WEB_PID")") / 1024 ))
total_mb=$(( ${pg_mb:-0} + ${kc_mb:-0} + api_mb + web_mb ))
for spec in "postgres:${pg_mb:-0}:300" "keycloak:${kc_mb:-0}:1000" "api:$api_mb:800" "web:$web_mb:1500" "total:$total_mb:3600"; do
  IFS=: read -r n v b <<<"$spec"
  check "memory.$n" "$(ok test "$v" -gt 0 -a "$v" -le "$b")" "${v} MB (budget ${b} MB)"
done
jq -nc --argjson pg "${pg_mb:-0}" --argjson kc "${kc_mb:-0}" --argjson api "$api_mb" --argjson web "$web_mb" --argjson total "$total_mb" \
  '{postgres_mb:$pg,keycloak_mb:$kc,api_mb:$api,web_mb:$web,total_mb:$total}' > "$RUN_DIR/memory.json"

# ---- AGENTS.md preserved
agents_same=1
if [[ -f "$RUN_DIR/AGENTS.md.snapshot" ]]; then cmp -s "$RUN_DIR/AGENTS.md.snapshot" "$ROOT/AGENTS.md" || agents_same=0; fi
git -C "$ROOT" diff --quiet -- AGENTS.md || agents_same=0
check "repo.agents-md-unchanged" "$agents_same" "AGENTS.md matches the committed file"

jq -s --argjson pass "$pass" --argjson fail "$fail" --arg at "$(date '+%Y-%m-%dT%H:%M:%S%z')" \
  '{at:$at,passed:$pass,failed:$fail,checks:.}' "$RESULTS" > "$RUN_DIR/check.json"
echo "local:check $pass passed, $fail failed (report: .local/run/check.json)"
exit $(( fail > 0 ))
