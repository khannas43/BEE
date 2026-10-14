/* eslint-disable */
/** Business settings (WP08.1h), through the portal API. Propose a value, a DIFFERENT person approves or rejects, withdraw, not in the past, the range and precision of each setting, one version per start day, the defaults in force untouched, and the permission following the role it is granted to. Versions start in the year 2100 so they never apply to a real action; run twice. The screen has its own checks when it lands (Brief 12). */
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");

const contract = require("./contract-lib.cjs");
const doc = contract.load();

const env = (k, d) => process.env[k] || d;
const key = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
let pass = 0, fail = 0;
function check(id, ok, detail) { const r = ok ? "PASS" : "FAIL"; ok ? pass++ : fail++; console.log(`${r.padEnd(4)} ${id.padEnd(52)} ${detail}`); }

function psql(user, pw, q) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${pw}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", user, "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
}
const sqlApp = (q) => psql("bee_app", env("BEE_APP_DB_PASSWORD", "bee-local-app"), q);
const sqlMaint = (q) => psql(env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint"), q);

const PATHS = { read: `${WEB}/api/runtime/business-settings`, propose: `${WEB}/api/runtime/business-settings/proposals`, decide: (id) => `${WEB}/api/runtime/business-settings/proposals/${id}/decision` };
const routeOf = (path) => (path.endsWith("/decision") ? "/api/runtime/business-settings/proposals/{id}/decision" : path.endsWith("/proposals") ? "/api/runtime/business-settings/proposals" : "/api/runtime/business-settings");

/** A request through the browser's session; every answer is checked against the artifact and recorded as live evidence. */
async function api(page, method, path, body, idem) {
  const headers = { "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) };
  const bodySnippet = body == null ? "undefined" : `JSON.stringify(${JSON.stringify(body)})`;
  const r = await page.eval(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "include", cache: "no-store", headers: ${JSON.stringify(headers)}, body: ${bodySnippet} }).then(async (r) => { const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; }); return { status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null), headers: hs }; })`);
  const route = routeOf(path);
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route, method, status: r.status, code: r.status >= 400 ? (r.body?.error ?? "-") : "-", ok: contract.conforms(doc, route, method, faux).length === 0 });
  return r;
}

const FAR = "2100-01-01";
const KEY_PROBE = "payment_tolerance_amount";
const DEFAULTS = { declared_iseer_max: "99.99", test_report_max_age_days: "1095", payment_tolerance_amount: "0.00", iseer_verify_tolerance: "99.99", certificate_validity_years: "3" };
const nextDate = () => sqlApp(`SELECT (coalesce(max(effective_from) FILTER (WHERE effective_from >= DATE '${FAR}'), DATE '${FAR}' - 1) + 1)::text FROM app.business_setting_version WHERE setting_key = '${KEY_PROBE}'`);
const addDays = (d, n) => sqlApp(`SELECT (DATE '${d}' + ${n})::text`);
const proposalRow = (id) => sqlApp(`SELECT state || '|' || (applied_version IS NOT NULL)::text || '|' || coalesce(decision_note, '') FROM app.business_setting_proposal WHERE id = '${id}'`);
const valuesInForce = () => sqlApp(`SELECT string_agg(setting_key || '=' || app.business_setting_value(setting_key, (now() AT TIME ZONE 'Asia/Kolkata')::date), ',' ORDER BY setting_key) FROM app.business_setting_def`);
const baseline = () => sqlApp(`SELECT (SELECT count(*) FROM app.model_application_rating) || '|' || (SELECT count(*) FROM app.model_application) || '|' || (SELECT count(*) FROM app.certificate)`);

const body = (date, reason, extra = {}) => ({ settingKey: KEY_PROBE, value: "7.00", effectiveFrom: date, sourceReference: "Live check", reason, ...extra });

async function runChecks(run, P) {
  const tag = crypto.randomUUID().slice(0, 8);
  const before = baseline();
  const inForceBefore = valuesInForce();
  const PERSONA = { nova: "nova.applicant", admin: "bee.admin", finance: "bee.finance" };
  const twinIds = Object.values(PERSONA).map((u) => `'${ids.accountId(u)}'`).join(",");
  sqlMaint(`INSERT INTO app.capability_grant (capability, role) VALUES ('business_setting_manage', 'finance') ON CONFLICT DO NOTHING`);
  try {
    // 1. Someone without the permission sees and does nothing.
    let r = await api(P.nova, "GET", PATHS.read, null, null);
    check(`${run}.applicant.cannot-read`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "POST", PATHS.propose, body(await nextDate(), `nova-${tag}`), key());
    check(`${run}.applicant.cannot-propose`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);

    // 2. The Administrator reads the five settings with their owner's-assumption defaults.
    r = await api(P.admin, "GET", PATHS.read, null, null);
    const byKey = Object.fromEntries((r.body?.settings ?? []).map((s) => [s.key, s]));
    check(`${run}.admin.reads-five-settings`, r.status === 200 && Object.keys(DEFAULTS).every((k) => byKey[k]) && r.body.settings.length === 5, Object.keys(byKey).join(","));
    check(`${run}.admin.defaults-are-in-force`, Object.entries(DEFAULTS).every(([k, v]) => byKey[k]?.defaultValue === v && byKey[k]?.valueInForce === v && byKey[k]?.inForceFrom === null), Object.entries(byKey).map(([k, s]) => `${k}=${s.valueInForce}`).join(" "));
    check(`${run}.admin.settings-carry-range-and-warning`, byKey.certificate_validity_years?.min === "1" && byKey.certificate_validity_years?.max === "10" && byKey.test_report_max_age_days?.warning !== null && byKey.declared_iseer_max?.decimals === 2, "range, precision and the warning");

    // 3. Propose; the proposer cannot approve or reject their own.
    const d1 = await nextDate();
    const reason1 = `p1-${tag}`;
    const p = await api(P.admin, "POST", PATHS.propose, body(d1, reason1), key());
    check(`${run}.admin.propose-201`, p.status === 201 && p.body?.state === "pending" && p.body?.proposedByYou === true && p.body?.value === "7.00" && p.body?.valueBefore === sqlApp(`SELECT app.business_setting_value('${KEY_PROBE}', DATE '${d1}' - 1)::numeric(12,2)::text`) && p.body?.applied === false, `${p.status} ${p.body?.state} ${p.body?.valueBefore}->${p.body?.value}`);
    const p1 = p.body?.id;
    check(`${run}.db.proposal-pending`, (await proposalRow(p1)).startsWith("pending"), await proposalRow(p1));
    r = await api(P.admin, "POST", PATHS.decide(p1), { decision: "approve" }, key());
    check(`${run}.admin.cannot-approve-own`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);
    r = await api(P.admin, "POST", PATHS.decide(p1), { decision: "reject" }, key());
    check(`${run}.admin.cannot-reject-own`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);

    // 4. Input rules.
    const past = sqlApp(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1)::text`);
    for (const [label, b] of [["past-date", body(past, `x-${tag}`)], ["unknown-setting", body(d1, `x-${tag}`, { settingKey: "no_such_setting" })],
      ["value-above-the-range", body(d1, `x-${tag}`, { value: "1000.01" })], ["value-below-the-range", body(d1, `x-${tag}`, { settingKey: "certificate_validity_years", value: "0" })],
      ["fraction-where-whole-numbers-only", body(d1, `x-${tag}`, { settingKey: "certificate_validity_years", value: "2.5" })],
      ["three-decimals", body(d1, `x-${tag}`, { value: "7.005" })], ["not-a-number", body(d1, `x-${tag}`, { value: "seven" })], ["blank-reason", body(d1, "   ")]]) {
      r = await api(P.admin, "POST", PATHS.propose, b, key());
      check(`${run}.admin.refuses-${label}`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    }
    r = await api(P.admin, "POST", PATHS.propose, body(d1, `x-${tag}`), null);
    check(`${run}.admin.key-required`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error}`);

    // 5. A different person approves: a version starts on the date; nothing in force today moves.
    r = await api(P.finance, "GET", PATHS.read, null, null);
    check(`${run}.finance.sees-the-pending-one-as-a-colleagues`, r.status === 200 && r.body.pending.some((x) => x.id === p1 && x.proposedByYou === false), `${r.status}`);
    r = await api(P.finance, "POST", PATHS.decide(p1), { decision: "approve", note: `ok-${tag}` }, key());
    check(`${run}.finance.approve-200`, r.status === 200 && r.body?.state === "approved" && r.body?.applied === true && r.body?.decisionNote === `ok-${tag}`, `${r.status} ${r.body?.state}`);
    check(`${run}.db.version-starts-on-the-date`, sqlApp(`SELECT value::text || '|' || effective_from FROM app.business_setting_version WHERE setting_key = '${KEY_PROBE}' AND effective_from = DATE '${d1}'`) === `7.00|${d1}`, "7.00 from " + d1);
    check(`${run}.db.approved-by-the-other-person`, sqlApp(`SELECT decided_by = '${ids.accountId(PERSONA.finance)}' AND proposed_by = '${ids.accountId(PERSONA.admin)}' FROM app.business_setting_proposal WHERE id = '${p1}'`) === "t", "decided_by Finance, proposed_by Admin");
    r = await api(P.admin, "GET", PATHS.read, null, null);
    const probe = r.body?.settings?.find((s) => s.key === KEY_PROBE);
    check(`${run}.admin.read-shows-it-as-scheduled-not-in-force`, probe?.valueInForce === "0.00" && probe?.scheduled?.some((v) => v.effectiveFrom === d1 && v.value === "7.00") && r.body.decided.some((x) => x.id === p1), `in force ${probe?.valueInForce}, scheduled ${probe?.scheduled?.length}`);
    r = await api(P.finance, "POST", PATHS.decide(p1), { decision: "approve" }, key());
    check(`${run}.finance.decided-is-final`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);

    // 6. A second value on the same day is refused and changes nothing; a later day is accepted.
    const c = await api(P.admin, "POST", PATHS.propose, body(d1, `c-${tag}`, { value: "9.00" }), key());
    r = await api(P.finance, "POST", PATHS.decide(c.body.id), { decision: "approve" }, key());
    check(`${run}.finance.same-day-refused`, r.status === 409 && r.body?.error === "rule_conflict" && (await proposalRow(c.body.id)).startsWith("pending"), `${r.status} ${r.body?.error}`);
    await api(P.admin, "POST", PATHS.decide(c.body.id), { decision: "withdraw" }, key());
    const d2 = await addDays(d1, 10);
    const n = await api(P.admin, "POST", PATHS.propose, body(d2, `n-${tag}`, { value: "11.00" }), key());
    r = await api(P.finance, "POST", PATHS.decide(n.body.id), { decision: "approve" }, key());
    check(`${run}.finance.later-day-accepted`, r.status === 200 && r.body?.value === "11.00" && r.body?.valueBefore === "7.00", `${r.status} ${r.body?.valueBefore}->${r.body?.value}`);

    // 7. Replay, withdraw, reject.
    const reason3 = `replay-${tag}`, k3 = key(), d3 = await addDays(d1, 20);
    const first = await api(P.admin, "POST", PATHS.propose, body(d3, reason3), k3);
    const again = await api(P.admin, "POST", PATHS.propose, body(d3, reason3), k3);
    check(`${run}.admin.replay-is-the-same-proposal`, first.status === 201 && again.status === 201 && again.replay === "true" && again.body?.id === first.body?.id, `${again.status} replay=${again.replay}`);
    r = await api(P.admin, "POST", PATHS.propose, body(d3, `${reason3}-other`), k3);
    check(`${run}.admin.key-reuse-with-other-body-conflicts`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "POST", PATHS.decide(first.body.id), { decision: "withdraw" }, key());
    check(`${run}.finance.cannot-withdraw-anothers`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.admin, "POST", PATHS.decide(first.body.id), { decision: "withdraw" }, key());
    check(`${run}.admin.withdraw`, r.status === 200 && r.body?.state === "withdrawn", `${r.status} ${r.body?.state}`);
    r = await api(P.finance, "POST", PATHS.decide(first.body.id), { decision: "approve" }, key());
    check(`${run}.finance.cannot-approve-a-withdrawn-one`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);
    const w = await api(P.admin, "POST", PATHS.propose, body(d3, `w-${tag}`), key());
    r = await api(P.finance, "POST", PATHS.decide(w.body.id), { decision: "reject", note: `no-${tag}` }, key());
    check(`${run}.finance.reject-with-note`, r.status === 200 && r.body?.state === "rejected" && (await proposalRow(w.body.id)) === `rejected|false|no-${tag}`, `${r.status} ${await proposalRow(w.body.id)}`);
    r = await api(P.finance, "POST", PATHS.decide("00000000-0000-4000-c000-0000000000ff"), { decision: "approve" }, key());
    check(`${run}.finance.unknown-proposal-404`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);

    // 8. The permission follows the role it is granted to.
    sqlMaint(`DELETE FROM app.capability_grant WHERE capability = 'business_setting_manage' AND role = 'finance'`);
    const m = await api(P.admin, "POST", PATHS.propose, body(await addDays(d1, 30), `m-${tag}`), key());
    r = await api(P.finance, "POST", PATHS.decide(m.body.id), { decision: "approve" }, key());
    check(`${run}.finance.refused-once-the-permission-is-removed`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "GET", PATHS.read, null, null);
    check(`${run}.finance.cannot-read-once-removed`, r.status === 403, `${r.status}`);
    await api(P.admin, "POST", PATHS.decide(m.body.id), { decision: "withdraw" }, key());

    // 9. Nothing in force today has moved, and no application, rating or certificate changed.
    check(`${run}.db.values-in-force-today-unchanged`, valuesInForce() === inForceBefore, valuesInForce());
    check(`${run}.db.applications-ratings-certificates-unchanged`, before === baseline(), "counts equal");
  } finally {
    sqlMaint(`DELETE FROM app.business_setting_proposal WHERE proposed_by IN (${twinIds}); DELETE FROM app.capability_grant WHERE capability = 'business_setting_manage' AND role = 'finance'`);
  }
}

async function main() {
  const chrome = await launchChrome();
  try {
    const who = { nova: ids.name("nova.applicant"), admin: ids.name("bee.admin"), finance: ids.name("bee.finance") };
    const P = {};
    for (const [k, u] of Object.entries(who)) {
      await totp.ensureEnrolled(u);
      P[k] = await openPage(chrome.cdp);
      if (!(await signIn(P[k], u))) throw new Error(`${k} sign-in failed`);
    }
    await runChecks("settings.run1", P);
    await runChecks("settings.run2", P);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("settings.run", false, String(e.message)))
  .then(() => {
    console.log(`business-settings checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
