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

# ---- Preflight: one failure when the runtime is not up (BL-030), not dozens of downstream probes.
down_parts=()
while IFS= read -r line; do [[ -n "$line" ]] && down_parts+=("$line"); done < <(runtime_health_down)
if ((${#down_parts[@]})); then
  down="$(printf '%s; ' "${down_parts[@]}")"
  down="${down%; }"
  check "runtime.preflight" 0 "down: ${down}. Start the runtime with: npm run local:up"
  jq -s --argjson pass "$pass" --argjson fail "$fail" --arg at "$(date '+%Y-%m-%dT%H:%M:%S%z')" \
    '{at:$at,passed:$pass,failed:$fail,checks:.}' "$RESULTS" > "$RUN_DIR/check.json"
  echo "local:check $pass passed, $fail failed (report: .local/run/check.json)"
  echo "ERROR: local runtime is not reachable ($down). Run: npm run local:up" >&2
  exit 1
fi

# ---- WP02.3: the 16 seeded users and the realm flows must come out of this run unchanged.
# Checks sign in only disposable twins (scripts/local/test-identities.cjs), removed at the end.
PROTECTED_BEFORE="$RUN_DIR/protected-before.json"
snap_out="$(node "$ROOT/scripts/local/protected-state.cjs" snapshot "$PROTECTED_BEFORE" 2>&1)" || { rm -f "$PROTECTED_BEFORE"; check "protected.snapshot" 0 "could not record the protected state: $(tail -1 <<<"$snap_out")"; }
for tag in test mfa misbind; do node "$ROOT/scripts/local/test-identities.cjs" teardown "$tag" >/dev/null 2>&1; done

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

append_own="$(psql_app -c "SELECT count(*) FROM pg_tables WHERE schemaname='app' AND tablename IN ('model_application_submission_event','model_application_fee_snapshot') AND tableowner='bee_app'" 2>/dev/null || echo 0)"
check "db.append-only-owner" "$(ok test "$append_own" = 2)" "submission event/fee tables owned by bee_app (migrate login), not Spring runtime"
runtime_ddl="$(docker exec -e PGPASSWORD="$BEE_RUNTIME_DB_PASSWORD" bee-local-postgres psql -h 127.0.0.1 -U "$BEE_RUNTIME_DB_USER" -d bee_app -c 'ALTER TABLE app.model_application_submission_event DISABLE TRIGGER reject_row_change' 2>&1 || true)"
check "db.runtime-no-trigger-ddl" "$(ok grep -qiE 'must be owner|permission denied' <<<"$runtime_ddl")" "bee_runtime cannot disable append-only triggers ($(grep -oE 'must be owner|permission denied' <<<"$runtime_ddl" | head -1 | cut -c1-40))"
runtime_fn="$(docker exec -e PGPASSWORD="$BEE_RUNTIME_DB_PASSWORD" bee-local-postgres psql -h 127.0.0.1 -U "$BEE_RUNTIME_DB_USER" -d bee_app -F ' ' -qtA -c "SELECT has_function_privilege('bee_runtime','app.app_disposable_model_cleanup(uuid[])','EXECUTE'), has_function_privilege('bee_runtime','app.master_supersede(text,text,integer,date,text,text,text,jsonb)','EXECUTE')" 2>/dev/null || echo "t t")"
check "db.runtime-no-privileged-functions" "$(ok test "$runtime_fn" = "f f")" "bee_runtime EXECUTE on cleanup and master_supersede = ${runtime_fn:-unknown} (expected f f)"

want="$(node "$ROOT/local/generate-fixtures.cjs" --counts)"
got="$(psql_app -F ' ' -c "SELECT (SELECT count(*) FROM app.organisation), (SELECT count(*) FROM app.user_account), (SELECT count(*) FROM app.organisation_membership), (SELECT count(*) FROM app.role_assignment), (SELECT count(*) FROM app.role_assignment WHERE active), (SELECT count(*) FROM app.assignment)" 2>/dev/null || true)"
read -r g_org g_usr g_mem g_role g_act g_asg <<<"$got"
w="$(jq -r '"\(.organisations) \(.userAccounts) \(.memberships) \(.roleAssignments) \(.activeRoleAssignments)"' <<<"$want")"
check "db.seed-counts" "$(ok test "$g_org $g_usr $g_mem $g_role $g_act" = "$w")" "org/user/membership/role/active = $g_org/$g_usr/$g_mem/$g_role/$g_act (expected ${w// //})"
# ---- WP04.1 effective-dated masters: fixture counts, the ₹1,000 / ₹24,000 versions, nothing BEE-verified, V2 tables retired
m_want="$(jq -r '.masters | "\(.master_category) \(.master_standard) \(.master_lab_accreditation) \(.master_fee_rule) \(.master_rating_formula)"' <<<"$want")"
m_got="$(psql_app -F ' ' -c "SELECT (SELECT count(*) FROM app.master_category), (SELECT count(*) FROM app.master_standard), (SELECT count(*) FROM app.master_lab_accreditation), (SELECT count(*) FROM app.master_fee_rule), (SELECT count(*) FROM app.master_rating_formula)" 2>/dev/null || true)"
check "db.masters-seeded" "$(ok test "$m_got" = "$m_want")" "category/standard/accreditation/fee/formula versions = ${m_got// //} (expected ${m_want// //})"
rule_state="$(psql_app -F ' ' -c "SELECT
  (SELECT string_agg(version || ':' || amount_inr || ':' || verification_status || ':' || coalesce(legacy_id, '-') || ':' || effective_from || '..' || coalesce(effective_to::text, 'open'), ',' ORDER BY version) FROM app.master_fee_rule WHERE rule_key = 'RAC:new_model'),
  (SELECT count(*) FROM app.master_rating_formula WHERE rule_key = 'RAC:star_rating' AND formula_label = '0-unverified' AND NOT computation_allowed AND definition = '{}'::jsonb AND legacy_id = 'RAC-STAR-DEMO'),
  (SELECT count(*) FROM (SELECT verification_status FROM app.master_category UNION ALL SELECT verification_status FROM app.master_standard UNION ALL SELECT verification_status FROM app.master_lab_accreditation
     UNION ALL SELECT verification_status FROM app.master_fee_rule UNION ALL SELECT verification_status FROM app.master_rating_formula) v WHERE verification_status = 'verified'),
  (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('fee_rule', 'rating_formula')),
  (SELECT count(*) FROM app.seed_run WHERE seed_version IN ('rt1-local-v2', 'wp04.1-masters-v1')),
  (SELECT count(*) FROM app.master_closure)" 2>/dev/null || true)"
check "db.provisional-rules" "$(ok test "$rule_state" = "1:1000.00:synthetic:RAC-DEMO:2026-01-01..2026-10-01,2:24000.00:provisional:-:2026-10-01..open 1 0 0 2 0")" "RAC fee versions ${rule_state%% *}; placeholder formula not computable; BEE-verified rows, V2 tables, seed markers, closures: $(cut -d' ' -f3- <<<"$rule_state") (expected 0 0 2 0)"
scope_want="$(jq -r '"\(.modelApplications) \(.assignments) \(.activeAssignments)"' <<<"$want")"
scope_got="$(psql_app -F ' ' -c "SELECT (SELECT count(*) FROM app.model_application), (SELECT count(*) FROM app.assignment), (SELECT count(*) FROM app.assignment WHERE active)" 2>/dev/null || true)"
wf_tables="$(psql_app -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('transition','fee_confirmation','rating_result','approval_decision')" 2>/dev/null || echo x)"
check "db.scope-fixtures-only" "$(ok test "$scope_got" = "$scope_want" -a "$wf_tables" = 0)" "applications/assignments/active = ${scope_got// //} (expected ${scope_want// //}); workflow tables=$wf_tables (transitions not implemented)"
grants="$(psql_app -c "SELECT count(*) FROM app.role_assignment WHERE role NOT IN ('admin','programme','reviewer','director','secretary','finance','helpdesk','auditor','manufacturer','agency','iame','sda','laboratory')" 2>/dev/null || echo x)"
check "db.no-matrix-grants" "$(ok test "$grants" = 0)" "role rows outside the 13 personas=$grants; no capacity grants table exists"
iso="$(docker exec -e PGPASSWORD="$BEE_APP_DB_PASSWORD" bee-local-postgres psql -h 127.0.0.1 -U bee_app -d keycloak -c 'SELECT 1' 2>&1 || true)"
check "db.keycloak-isolated" "$(ok grep -q 'permission denied' <<<"$iso")" "bee_app login to keycloak db: $(grep -o 'permission denied[^"]*' <<<"$iso" | head -1 | cut -c1-60)"

# ---- tokens: Keycloak identifies, Spring decides (as disposable twins of the personas)
id_out="$(node "$ROOT/scripts/local/test-identities.cjs" setup test 2>&1)"
check "test-identities.created" "$(ok grep -q '^created 16' <<<"$id_out")" "$id_out (test.<persona>: same Keycloak role and bee_app rows as the seeded persona)"
export BEE_TEST_IDENTITIES=test
trap 'node "$ROOT/scripts/local/test-identities.cjs" teardown test >/dev/null 2>&1' EXIT
token() { # password grant with TOTP for the persona's twin (scripts/local/totp.cjs enrolls the twin)
  node "$ROOT/scripts/local/totp.cjs" token "test.$1" 2>/dev/null || true
}
me() { curl -s -o "$RUN_DIR/me.body" -w '%{http_code}' --max-time 5 -H "Authorization: Bearer $1" "$API/api/me"; }

t_nova="$(token nova.applicant)"
check "token.issued" "$(ok test -n "$t_nova")" "password grant with TOTP via bee-local-check client"
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
for u in nova.applicant pixel.applicant no.account inactive.role role.mismatch; do node "$ROOT/scripts/local/totp.cjs" logout "test.$u" >/dev/null 2>&1 || true; done

# ---- WP02.1 sign-in through Next.js server routes (scripts/local/auth-check.cjs)
auth_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/auth-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$auth_out"
read -r a_pass a_fail <<<"$(sed -nE 's/^auth checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$auth_out")"
if [[ -z "${a_pass:-}" ]]; then check "auth.run" 0 "auth-check did not complete: $(tail -1 <<<"$auth_out")"
else pass=$((pass + a_pass)); fail=$((fail + a_fail)); fi

# ---- WP02.2 model-application scope, direct to Spring (scripts/local/access-check.cjs)
ac_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/access-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$ac_out"
read -r c_pass c_fail <<<"$(sed -nE 's/^access checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$ac_out")"
if [[ -z "${c_pass:-}" ]]; then check "access.run" 0 "access-check did not complete: $(tail -1 <<<"$ac_out")"
else pass=$((pass + c_pass)); fail=$((fail + c_fail)); fi

# ---- signed-in screens identify the preview, not a fake identity (scripts/local/browser-check.cjs)
br_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$br_out"
read -r b_pass b_fail <<<"$(sed -nE 's/^browser checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$br_out")"
if [[ -z "${b_pass:-}" ]]; then check "browser.run" 0 "browser-check did not complete: $(tail -1 <<<"$br_out")"
else pass=$((pass + b_pass)); fail=$((fail + b_fail)); fi

# ---- WP02.3 local TOTP: enrollment, challenge, rejection, logout (scripts/local/mfa-check.cjs)
mf_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/mfa-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$mf_out"
read -r m_pass m_fail <<<"$(sed -nE 's/^mfa checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$mf_out")"
if [[ -z "${m_pass:-}" ]]; then check "mfa.run" 0 "mfa-check did not complete: $(tail -1 <<<"$mf_out")"
else pass=$((pass + m_pass)); fail=$((fail + m_fail)); fi

# ---- WP03.3: contract-check and bff-check record every conforms() result here for the coverage matrix
export CONTRACT_OBSERVED="$RUN_DIR/contract-observed.jsonl"
: > "$CONTRACT_OBSERVED"

# ---- WP03.1 OpenAPI contract, errors and correlation across Spring and Next.js (scripts/local/contract-check.cjs)
ct_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/contract-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$ct_out"
read -r k_pass k_fail <<<"$(sed -nE 's/^contract checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$ct_out")"
if [[ -z "${k_pass:-}" ]]; then check "contract.run" 0 "contract-check did not complete: $(tail -1 <<<"$ct_out")"
else pass=$((pass + k_pass)); fail=$((fail + k_fail)); fi

# ---- WP03.2 browser-facing model reads through the Next.js BFF (scripts/local/bff-check.cjs)
bf_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/bff-check.cjs" --with-expiry 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$bf_out"
read -r f_pass f_fail <<<"$(sed -nE 's/^bff checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$bf_out")"
if [[ -z "${f_pass:-}" ]]; then check "bff.run" 0 "bff-check did not complete: $(tail -1 <<<"$bf_out")"
else pass=$((pass + f_pass)); fail=$((fail + f_fail)); fi

# ---- WP05.1b draft create/edit (records runtime draft pairs for contract coverage)
md_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/model-drafts-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$md_out"
read -r d_pass d_fail <<<"$(sed -nE 's/^model-drafts checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$md_out")"
if [[ -z "${d_pass:-}" ]]; then check "drafts.run" 0 "model-drafts-browser-check did not complete: $(tail -1 <<<"$md_out")"
else pass=$((pass + d_pass)); fail=$((fail + d_fail)); fi

# ---- WP05.1c submit through BFF (records runtime submit pairs for contract coverage)
ms_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/model-submit-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$ms_out"
read -r s_pass s_fail <<<"$(sed -nE 's/^model-submit checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$ms_out")"
if [[ -z "${s_pass:-}" ]]; then check "submit.run" 0 "model-submit did not complete: $(tail -1 <<<"$ms_out")"
else pass=$((pass + s_pass)); fail=$((fail + s_fail)); fi

# ---- first slice step 2: Finance confirms the fee through the BFF and the portal (records runtime fee-confirmation pairs)
fc_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/fee-confirmation-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$fc_out"
read -r fc_pass fc_fail <<<"$(sed -nE 's/^fee-confirmation checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$fc_out")"
if [[ -z "${fc_pass:-}" ]]; then check "fee.run" 0 "fee-confirmation-browser-check did not complete: $(tail -1 <<<"$fc_out")"
else pass=$((pass + fc_pass)); fail=$((fail + fc_fail)); fi

# ---- first slice step 3: the assigned IAME officer recommends through the BFF and the portal (records runtime iame-recommendation pairs)
ir_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/iame-recommendation-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$ir_out"
read -r ir_pass ir_fail <<<"$(sed -nE 's/^iame-recommendation checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$ir_out")"
if [[ -z "${ir_pass:-}" ]]; then check "iame.run" 0 "iame-recommendation-browser-check did not complete: $(tail -1 <<<"$ir_out")"
else pass=$((pass + ir_pass)); fail=$((fail + ir_fail)); fi

# ---- first slice step 4: the assigned Reviewer forwards through the BFF and the portal (records runtime reviewer-forward pairs)
rf_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/reviewer-forward-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$rf_out"
read -r rf_pass rf_fail <<<"$(sed -nE 's/^reviewer-forward checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$rf_out")"
if [[ -z "${rf_pass:-}" ]]; then check "reviewer.run" 0 "reviewer-forward-browser-check did not complete: $(tail -1 <<<"$rf_out")"
else pass=$((pass + rf_pass)); fail=$((fail + rf_fail)); fi

# ---- first slice step 5: Programme computes the provisional rating through the BFF and the portal (records runtime rating pairs)
rt_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/rating-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$rt_out"
read -r rt_pass rt_fail <<<"$(sed -nE 's/^rating checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$rt_out")"
if [[ -z "${rt_pass:-}" ]]; then check "rating.run" 0 "rating-browser-check did not complete: $(tail -1 <<<"$rt_out")"
else pass=$((pass + rt_pass)); fail=$((fail + rt_fail)); fi

# ---- first slice step 6: the Director recommends through the BFF and the portal (records runtime director-recommendation pairs)
dr_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/director-recommendation-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$dr_out"
read -r dr_pass dr_fail <<<"$(sed -nE 's/^director-recommendation checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$dr_out")"
if [[ -z "${dr_pass:-}" ]]; then check "director.run" 0 "director-recommendation-browser-check did not complete: $(tail -1 <<<"$dr_out")"
else pass=$((pass + dr_pass)); fail=$((fail + dr_fail)); fi

# ---- first slice step 7: the Secretary gives final approval through the BFF and the portal (records runtime secretary-approval pairs)
sa_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/secretary-approval-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$sa_out"
read -r sa_pass sa_fail <<<"$(sed -nE 's/^secretary-approval checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$sa_out")"
if [[ -z "${sa_pass:-}" ]]; then check "secretary.run" 0 "secretary-approval-browser-check did not complete: $(tail -1 <<<"$sa_out")"
else pass=$((pass + sa_pass)); fail=$((fail + sa_fail)); fi

# ---- Wave 1: return to the applicant, edit, resubmit (records runtime return and resubmit pairs)
rw_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/return-resubmit-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$rw_out"
read -r rw_pass rw_fail <<<"$(sed -nE 's/^return-resubmit checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$rw_out")"
if [[ -z "${rw_pass:-}" ]]; then check "rework.run" 0 "return-resubmit-browser-check did not complete: $(tail -1 <<<"$rw_out")"
else pass=$((pass + rw_pass)); fail=$((fail + rw_fail)); fi

# ---- Wave 1: permanent rejection by a stage owner (records runtime reject pairs)
rj_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/reject-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$rj_out"
read -r rj_pass rj_fail <<<"$(sed -nE 's/^reject checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$rj_out")"
if [[ -z "${rj_pass:-}" ]]; then check "reject.run" 0 "reject-browser-check did not complete: $(tail -1 <<<"$rj_out")"
else pass=$((pass + rj_pass)); fail=$((fail + rj_fail)); fi

# ---- Wave 1: the history of an application, and what each reader sees of it (records the runtime history pairs)
hs_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/history-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$hs_out"
read -r hs_pass hs_fail <<<"$(sed -nE 's/^history checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$hs_out")"
if [[ -z "${hs_pass:-}" ]]; then check "history.run" 0 "history-browser-check did not complete: $(tail -1 <<<"$hs_out")"
else pass=$((pass + hs_pass)); fail=$((fail + hs_fail)); fi

# ---- WP06.1a document intake through BFF (records runtime document pairs for contract coverage)
mdoc_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/model-documents-browser-check.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$mdoc_out"
read -r doc_pass doc_fail <<<"$(sed -nE 's/^model-documents checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$mdoc_out")"
if [[ -z "${doc_pass:-}" ]]; then check "documents.run" 0 "model-documents-browser-check did not complete: $(tail -1 <<<"$mdoc_out")"
else pass=$((pass + doc_pass)); fail=$((fail + doc_fail)); fi

# ---- route wiring: every documented route is registered everywhere a route must be (static; names the missing file)
if wiring_out="$(node "$ROOT/scripts/local/wiring-check.cjs" 2>&1)"; then check "wiring.routes" 1 "$(tail -1 <<<"$wiring_out")"
else check "wiring.routes" 0 "$(grep -E '^FAIL' <<<"$wiring_out" | head -3 | tr '\n' ';') $(tail -1 <<<"$wiring_out")"; fi

# ---- WP03.3 coverage: every documented (operation, status, code) has live, stand-in, MockMvc or unit evidence
cv_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/contract-coverage.cjs" 2>&1)"
grep -E '^(PASS|FAIL) ' <<<"$cv_out"
read -r v_pass v_fail <<<"$(sed -nE 's/^coverage checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$cv_out")"
if [[ -z "${v_pass:-}" ]]; then check "coverage.run" 0 "contract-coverage did not complete: $(tail -1 <<<"$cv_out")"
else pass=$((pass + v_pass)); fail=$((fail + v_fail)); fi

# ---- WP04.1 master resolution, overlap, gap, immutability, supersession, rollback, seeding and reset tests (real PostgreSQL, throwaway schemas)
JAVA_HOME="$(/usr/libexec/java_home -v 17)" mvn -q -B -f "$ROOT/backend/pom.xml" test -Dgroups=db -Dbee.test.excludedGroups=none -Dsurefire.failIfNoSpecifiedTests=false > "$RUN_DIR/masters-test.log" 2>&1
mt_rc=$?
mt_xml="$ROOT/backend/target/surefire-reports/TEST-gov.bee.api.masters.MastersDatabaseTest.xml"
mt="$(grep -oE 'tests="[0-9]+" errors="[0-9]+" skipped="[0-9]+" failures="[0-9]+"' "$mt_xml" 2>/dev/null | head -1)"
left="$(psql_app -c "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'wp041_test_%'" 2>/dev/null || echo x)"
check "masters.db-tests" "$(ok test "$mt_rc" = 0 -a -n "$mt" -a "$left" = 0 -a "$(grep -c 'errors="0" skipped="0" failures="0"' <<<"$mt")" = 1)" "MastersDatabaseTest: ${mt:-no report} (exit $mt_rc); throwaway schemas left: $left"

# ---- WP02.3: seeded users' OTP credentials and sessions, and the realm flows, unchanged
node "$ROOT/scripts/local/test-identities.cjs" teardown test >/dev/null 2>&1
trap - EXIT
if [[ -f "$PROTECTED_BEFORE" ]]; then
  pr_out="$(AUTH_RESULTS="$RESULTS" node "$ROOT/scripts/local/protected-state.cjs" compare "$PROTECTED_BEFORE" 2>&1)"
  grep -E '^(PASS|FAIL) ' <<<"$pr_out"
  read -r p_pass p_fail <<<"$(sed -nE 's/^protected checks: ([0-9]+) passed, ([0-9]+) failed$/\1 \2/p' <<<"$pr_out")"
  if [[ -z "${p_pass:-}" ]]; then check "protected.run" 0 "protected-state compare did not complete: $(tail -1 <<<"$pr_out")"
  else pass=$((pass + p_pass)); fail=$((fail + p_fail)); fi
fi

# ---- memory against ADR-001 D-RT8 (MB); median of several samples after checks finish (BL-032)
mem_mb() { docker stats --no-stream --format '{{.MemUsage}}' "$1" 2>/dev/null | awk '{v=$1; u=v; gsub(/[0-9.]/,"",u); gsub(/[A-Za-z]/,"",v); if(u=="GiB")v*=1024; else if(u=="KiB")v/=1024; printf "%d", v}'; }
sample_process_mb() { pid_alive "$1" && echo $(( $(tree_rss_kb "$(cat "$1")") / 1024 )) || echo 0; }
MEMORY_SAMPLES="${BEE_CHECK_MEMORY_SAMPLES:-5}"
MEMORY_INTERVAL="${BEE_CHECK_MEMORY_INTERVAL_SEC:-3}"
BUDGET_PG="${BEE_CHECK_MEMORY_BUDGET_POSTGRES:-300}"
BUDGET_KC="${BEE_CHECK_MEMORY_BUDGET_KEYCLOAK:-1000}"
BUDGET_API="${BEE_CHECK_MEMORY_BUDGET_API:-800}"
BUDGET_WEB="${BEE_CHECK_MEMORY_BUDGET_WEB:-1500}"
BUDGET_TOTAL="${BEE_CHECK_MEMORY_BUDGET_TOTAL:-3600}"
pg_samples=(); kc_samples=(); api_samples=(); web_samples=(); total_samples=()
for ((i = 1; i <= MEMORY_SAMPLES; i++)); do
  pg_s="$(mem_mb bee-local-postgres)"; kc_s="$(mem_mb bee-local-keycloak)"
  api_s="$(sample_process_mb "$API_PID")"; web_s="$(sample_process_mb "$WEB_PID")"
  pg_samples+=("${pg_s:-0}"); kc_samples+=("${kc_s:-0}"); api_samples+=("$api_s"); web_samples+=("$web_s")
  total_samples+=($(( ${pg_s:-0} + ${kc_s:-0} + api_s + web_s )))
  (( i < MEMORY_SAMPLES )) && sleep "$MEMORY_INTERVAL"
done
pg_mb="$(memory_median_mb "${pg_samples[@]}")"
kc_mb="$(memory_median_mb "${kc_samples[@]}")"
api_mb="$(memory_median_mb "${api_samples[@]}")"
web_mb="$(memory_median_mb "${web_samples[@]}")"
total_mb="$(memory_median_mb "${total_samples[@]}")"
pg_list="$(IFS=,; echo "${pg_samples[*]}")"
kc_list="$(IFS=,; echo "${kc_samples[*]}")"
api_list="$(IFS=,; echo "${api_samples[*]}")"
web_list="$(IFS=,; echo "${web_samples[*]}")"
total_list="$(IFS=,; echo "${total_samples[*]}")"
for spec in "postgres:$pg_mb:$BUDGET_PG:$pg_list" "keycloak:$kc_mb:$BUDGET_KC:$kc_list" "api:$api_mb:$BUDGET_API:$api_list" "web:$web_mb:$BUDGET_WEB:$web_list" "total:$total_mb:$BUDGET_TOTAL:$total_list"; do
  IFS=: read -r n v b samples <<<"$spec"
  check "memory.$n" "$(ok test "$v" -gt 0 -a "$v" -le "$b")" "median ${v} MB from samples [${samples}] MB (budget ${b} MB; interval ${MEMORY_INTERVAL}s x ${MEMORY_SAMPLES})"
done
jq -nc \
  --argjson pg "$pg_mb" --argjson kc "$kc_mb" --argjson api "$api_mb" --argjson web "$web_mb" --argjson total "$total_mb" \
  --argjson pg_samples "$(printf '%s\n' "${pg_samples[@]}" | jq -R 'tonumber?' | jq -s 'map(select(. != null))')" \
  --argjson kc_samples "$(printf '%s\n' "${kc_samples[@]}" | jq -R 'tonumber?' | jq -s 'map(select(. != null))')" \
  --argjson api_samples "$(printf '%s\n' "${api_samples[@]}" | jq -R 'tonumber?' | jq -s 'map(select(. != null))')" \
  --argjson web_samples "$(printf '%s\n' "${web_samples[@]}" | jq -R 'tonumber?' | jq -s 'map(select(. != null))')" \
  --argjson total_samples "$(printf '%s\n' "${total_samples[@]}" | jq -R 'tonumber?' | jq -s 'map(select(. != null))')" \
  '{postgres_mb:$pg,keycloak_mb:$kc,api_mb:$api,web_mb:$web,total_mb:$total,postgres_samples:$pg_samples,keycloak_samples:$kc_samples,api_samples:$api_samples,web_samples:$web_samples,total_samples:$total_samples}' \
  > "$RUN_DIR/memory.json"

# ---- AGENTS.md preserved
agents_same=1
if [[ -f "$RUN_DIR/AGENTS.md.snapshot" ]]; then cmp -s "$RUN_DIR/AGENTS.md.snapshot" "$ROOT/AGENTS.md" || agents_same=0; fi
git -C "$ROOT" diff --quiet -- AGENTS.md || agents_same=0
check "repo.agents-md-unchanged" "$agents_same" "AGENTS.md matches the committed file"

jq -s --argjson pass "$pass" --argjson fail "$fail" --arg at "$(date '+%Y-%m-%dT%H:%M:%S%z')" \
  '{at:$at,passed:$pass,failed:$fail,checks:.}' "$RESULTS" > "$RUN_DIR/check.json"
echo "local:check $pass passed, $fail failed (report: .local/run/check.json)"
exit $(( fail > 0 ))
