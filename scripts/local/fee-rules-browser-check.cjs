/* eslint-disable */
/** Wave 2 start: fee-rule administration. Propose, a DIFFERENT person approves or rejects, withdraw, not in the past, close-and-start of the rule, and the permission following the role it is granted to. Uses a probe application type (live_check), never the real RAC:new_model rule; baseline-preserving for everything an application uses, run twice. */
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

const PROBE = "RAC:live_check";
const PATHS = { read: `${WEB}/api/runtime/fee-rules`, propose: `${WEB}/api/runtime/fee-rules/proposals`, decide: (id) => `${WEB}/api/runtime/fee-rules/proposals/${id}/decision` };
const SCREEN = "/app/administration/fee-rules";

const routeOf = (path) => (path.endsWith("/decision") ? "/api/runtime/fee-rules/proposals/{id}/decision" : path.endsWith("/proposals") ? "/api/runtime/fee-rules/proposals" : "/api/runtime/fee-rules");

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
async function setInput(page, testId, value, kind = "HTMLInputElement", event = "input") {
  await page.eval(`(() => {
    const el = document.querySelector('[data-testid=${testId}]');
    const s = Object.getOwnPropertyDescriptor(window.${kind}.prototype, 'value').set;
    s.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
    return true;
  })()`);
}
const uiClick = (page, testId) => page.eval(`document.querySelector('[data-testid="${testId}"]').click(); true`);
const present = (page, testId, ms = 20000) => page.waitFor(`!!document.querySelector('[data-testid="${testId}"]')`, ms);
const textOf = (page, testId) => page.eval(`document.querySelector('[data-testid="${testId}"]')?.textContent ?? ""`);
const gone = (page, testId, ms = 20000) => page.waitFor(`!document.querySelector('[data-testid="${testId}"]')`, ms);

async function open(page, route, readyTestId) {
  await page.goto(`${WEB}${route}`);
  return present(page, readyTestId, 30000);
}

const nextDate = () => sqlApp(`SELECT (coalesce(max(effective_from), DATE '2100-01-01') + 1)::text FROM app.master_fee_rule WHERE rule_key = '${PROBE}'`);
const proposalRow = (id) => sqlApp(`SELECT state || '|' || coalesce(applied_version::text, '') || '|' || coalesce(decision_note, '') FROM app.fee_rule_proposal WHERE id = '${id}'`);
const baseline = () => sqlApp(`SELECT
  (SELECT count(*) || '/' || coalesce(string_agg(version || ':' || amount_inr, ',' ORDER BY version), '') FROM app.master_fee_rule WHERE rule_key = 'RAC:new_model') || '|' ||
  (SELECT count(*) FROM app.model_application) || '|' || (SELECT count(*) FROM app.model_application_fee_snapshot) || '|' || (SELECT count(*) FROM app.master_closure WHERE rule_key = 'RAC:new_model')`);

async function pendingIdByReason(admin, reason) {
  const r = await api(admin, "GET", PATHS.read, null, null);
  return r.body?.pending?.find((p) => p.reason === reason)?.id ?? null;
}
const proposeBody = (date, amount, reason, extra = {}) => ({ categoryCode: "RAC", applicationType: "live_check", amountInr: amount, taxRatePercent: "18.00", effectiveFrom: date, sourceReference: "Live check", reason, ...extra });

async function runChecks(run, P, who) {
  const tag = crypto.randomUUID().slice(0, 8);
  const before = baseline();
  const PERSONA = { nova: "nova.applicant", admin: "bee.admin", finance: "bee.finance" };
  const twinIds = Object.values(PERSONA).map((u) => `'${ids.accountId(u)}'`).join(",");
  sqlMaint(`INSERT INTO app.fee_application_type (code, label) VALUES ('live_check', 'Live check') ON CONFLICT DO NOTHING; INSERT INTO app.capability_grant (capability, role) VALUES ('fee_rule_manage', 'finance') ON CONFLICT DO NOTHING`);
  try {
    // 1. Someone without the permission sees and does nothing.
    let r = await api(P.nova, "GET", PATHS.read, null, null);
    check(`${run}.applicant.cannot-read`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "POST", PATHS.propose, proposeBody(await nextDate(), "100.00", `nova-${tag}`), key());
    check(`${run}.applicant.cannot-propose`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    await open(P.nova, SCREEN, "feerules-error");
    check(`${run}.applicant.screen-shows-refusal`, !(await present(P.nova, "feerule-propose", 1500)), "no proposal form for the applicant");

    // 2. The Administrator reads the rules, with the separate tax line.
    r = await api(P.admin, "GET", PATHS.read, null, null);
    const real = r.body?.rules?.find((x) => x.ruleKey === "RAC:new_model");
    const inForce = real?.versions?.find((v) => v.inForce);
    check(`${run}.admin.reads-rules`, r.status === 200 && inForce?.amountInr === "24000.00" && inForce?.taxRatePercent === "0.00", `RAC:new_model in force ${inForce?.amountInr} tax ${inForce?.taxRatePercent}`);
    check(`${run}.admin.sees-the-probe-type`, r.body?.applicationTypes?.some((t) => t.code === "live_check"), "application types come from data");
    await open(P.admin, SCREEN, "feerules-screen");
    await present(P.admin, "feerules-version-RAC:new_model-2");
    const row = await textOf(P.admin, "feerules-version-RAC:new_model-2");
    check(`${run}.admin.ui-shows-the-rule`, /24,000\.00/.test(row) && /not set/.test(row) && /In force/.test(row), row.replace(/\s+/g, " ").slice(0, 90));
    check(`${run}.admin.ui-states-the-rules`, /different person approves/.test(await textOf(P.admin, "feerules-notes")) && /separate line/.test(await textOf(P.admin, "feerules-notes")), "two people, never the past, tax separate");

    // 3. Propose in the portal; the proposer can only withdraw, and the server refuses their own approval.
    const d1 = await nextDate();
    const reason1 = `ui-${tag}`;
    await setInput(P.admin, "feerule-type", "live_check", "HTMLSelectElement", "change");
    await setInput(P.admin, "feerule-amount", "31000.00");
    await setInput(P.admin, "feerule-tax", "18");
    await setInput(P.admin, "feerule-from", d1);
    await setInput(P.admin, "feerule-source", "Live check circular");
    await setInput(P.admin, "feerule-reason", reason1, "HTMLTextAreaElement");
    await uiClick(P.admin, "feerule-propose-run");
    check(`${run}.admin.ui-propose-success`, await present(P.admin, "feerule-propose-success", 15000), (await textOf(P.admin, "feerule-propose-success")).slice(0, 100));
    const p1 = await pendingIdByReason(P.admin, reason1);
    check(`${run}.admin.proposal-pending-in-db`, p1 && (await proposalRow(p1)).startsWith("pending"), `${p1} ${p1 ? await proposalRow(p1) : ""}`);
    await present(P.admin, `feerules-pending-${p1}`);
    const own = await P.admin.eval(`(() => { const li = document.querySelector('[data-testid="feerules-pending-${p1}"]'); return [li?.getAttribute('data-proposed-by-you'), !!document.querySelector('[data-testid="feerule-withdraw-run-${p1}"]'), !!document.querySelector('[data-testid="feerule-approve-run-${p1}"]')].join(','); })()`);
    check(`${run}.admin.own-proposal-only-withdraw`, own === "true,true,false", own);
    r = await api(P.admin, "POST", PATHS.decide(p1), { decision: "approve" }, key());
    check(`${run}.admin.cannot-approve-own`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);
    r = await api(P.admin, "POST", PATHS.decide(p1), { decision: "reject" }, key());
    check(`${run}.admin.cannot-reject-own`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);

    // 4. Input rules.
    const past = sqlApp(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1)::text`);
    for (const [label, b] of [["past-date", proposeBody(past, "100.00", `x-${tag}`)], ["unknown-type", proposeBody(d1, "100.00", `x-${tag}`, { applicationType: "nothing" })],
      ["three-decimals", proposeBody(d1, "100.005", `x-${tag}`)], ["tax-over-100", proposeBody(d1, "100.00", `x-${tag}`, { taxRatePercent: "100.01" })], ["blank-reason", proposeBody(d1, "100.00", "   ")]]) {
      r = await api(P.admin, "POST", PATHS.propose, b, key());
      check(`${run}.admin.refuses-${label}`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    }
    r = await api(P.admin, "POST", PATHS.propose, proposeBody(d1, "100.00", `x-${tag}`), null);
    check(`${run}.admin.key-required`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error}`);

    // 5. A different person approves in the portal: the rule in force ends on the date and the new one starts.
    await open(P.finance, SCREEN, "feerules-screen");
    await present(P.finance, `feerules-pending-${p1}`);
    const colleague = await P.finance.eval(`[!!document.querySelector('[data-testid="feerule-approve-run-${p1}"]'), !!document.querySelector('[data-testid="feerule-reject-run-${p1}"]'), !!document.querySelector('[data-testid="feerule-withdraw-run-${p1}"]')].join(',')`);
    check(`${run}.finance.sees-approve-and-reject-not-withdraw`, colleague === "true,true,false", colleague);
    await setInput(P.finance, `feerule-note-${p1}`, `ok-${tag}`);
    await uiClick(P.finance, `feerule-approve-run-${p1}`);
    check(`${run}.finance.ui-approve-success`, await present(P.finance, `feerule-decided-${p1}`, 15000), (await textOf(P.finance, `feerule-decided-${p1}`)).slice(0, 90));
    const [st, ver] = (await proposalRow(p1)).split("|");
    const rule = sqlApp(`SELECT amount_inr || '|' || tax_rate_percent || '|' || verification_status || '|' || effective_from FROM app.master_fee_rule WHERE rule_key = '${PROBE}' AND version = ${Number(ver) || 0}`);
    check(`${run}.db.rule-started-from-the-date`, st === "approved" && rule === `31000.00|18.00|provisional|${d1}`, `${st} v${ver} ${rule}`);
    check(`${run}.db.approved-by-the-other-person`, sqlApp(`SELECT decided_by = '${ids.accountId(PERSONA.finance)}' AND proposed_by = '${ids.accountId(PERSONA.admin)}' FROM app.fee_rule_proposal WHERE id = '${p1}'`) === "t", "decided_by is Finance, proposed_by is the Administrator");
    r = await api(P.finance, "POST", PATHS.decide(p1), { decision: "approve" }, key());
    check(`${run}.finance.decided-is-final`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);

    // 6. A newer rule closes the one in force on its own date.
    const d2 = await nextDate();
    const reason2 = `next-${tag}`;
    r = await api(P.admin, "POST", PATHS.propose, proposeBody(d2, "32000.00", reason2), key());
    check(`${run}.admin.api-propose-201`, r.status === 201 && r.body?.state === "pending" && r.body?.proposedByYou === true, `${r.status} ${r.body?.state}`);
    const p2 = r.body?.id;
    r = await api(P.finance, "POST", PATHS.decide(p2), { decision: "approve", note: "ok" }, key());
    check(`${run}.finance.api-approve-200`, r.status === 200 && r.body?.state === "approved" && r.body?.appliedVersion === Number(ver) + 1, `${r.status} ${r.body?.state} v${r.body?.appliedVersion}`);
    check(`${run}.db.previous-rule-closed-on-the-date`, sqlApp(`SELECT effective_to::text FROM app.master_closure WHERE master_table = 'master_fee_rule' AND rule_key = '${PROBE}' AND version = ${Number(ver)}`) === d2, `v${ver} ends ${d2}`);

    // 7. Replay, conflict, withdraw, reject.
    const reason3 = `replay-${tag}`;
    const k3 = key();
    const d3 = await nextDate();
    const first = await api(P.admin, "POST", PATHS.propose, proposeBody(d3, "33000.00", reason3), k3);
    const again = await api(P.admin, "POST", PATHS.propose, proposeBody(d3, "33000.00", reason3), k3);
    check(`${run}.admin.replay-is-the-same-proposal`, first.status === 201 && again.status === 201 && again.replay === "true" && again.body?.id === first.body?.id, `${again.status} replay=${again.replay}`);
    r = await api(P.admin, "POST", PATHS.propose, proposeBody(d3, "34000.00", reason3), k3);
    check(`${run}.admin.key-reuse-with-other-body-conflicts`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error}`);
    // Withdraw it in the portal.
    await open(P.admin, SCREEN, "feerules-screen");
    await present(P.admin, `feerule-withdraw-run-${first.body.id}`);
    await uiClick(P.admin, `feerule-withdraw-run-${first.body.id}`);
    check(`${run}.admin.ui-withdraw`, await present(P.admin, `feerule-decided-${first.body.id}`, 15000) && (await proposalRow(first.body.id)).startsWith("withdrawn"), await proposalRow(first.body.id));
    r = await api(P.finance, "POST", PATHS.decide(first.body.id), { decision: "approve" }, key());
    check(`${run}.finance.cannot-approve-a-withdrawn-one`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);
    // Only the proposer may withdraw.
    const reasonW = `w-${tag}`;
    const w = await api(P.admin, "POST", PATHS.propose, proposeBody(d3, "35000.00", reasonW), key());
    r = await api(P.finance, "POST", PATHS.decide(w.body.id), { decision: "withdraw" }, key());
    check(`${run}.finance.cannot-withdraw-another's`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    // Reject in the portal with a note.
    await open(P.finance, SCREEN, "feerules-screen");
    await present(P.finance, `feerule-reject-run-${w.body.id}`);
    await setInput(P.finance, `feerule-note-${w.body.id}`, `no-${tag}`);
    await uiClick(P.finance, `feerule-reject-run-${w.body.id}`);
    check(`${run}.finance.ui-reject-with-note`, await present(P.finance, `feerule-decided-${w.body.id}`, 15000) && (await proposalRow(w.body.id)) === `rejected||no-${tag}`, await proposalRow(w.body.id));
    // A start date that is not after the rule already open cannot be applied; the proposal stays pending.
    const open2 = sqlApp(`SELECT effective_from::text FROM app.master_fee_rule WHERE rule_key = '${PROBE}' ORDER BY version DESC LIMIT 1`);
    const c = await api(P.admin, "POST", PATHS.propose, proposeBody(open2, "36000.00", `c-${tag}`), key());
    r = await api(P.finance, "POST", PATHS.decide(c.body.id), { decision: "approve" }, key());
    check(`${run}.finance.date-conflict-refused`, r.status === 409 && r.body?.error === "rule_conflict" && (await proposalRow(c.body.id)).startsWith("pending"), `${r.status} ${r.body?.error} ${await proposalRow(c.body.id)}`);
    await api(P.admin, "POST", PATHS.decide(c.body.id), { decision: "withdraw" }, key());

    // 8. The permission follows the role it is granted to.
    sqlMaint(`DELETE FROM app.capability_grant WHERE capability = 'fee_rule_manage' AND role = 'finance'`);
    const m = await api(P.admin, "POST", PATHS.propose, proposeBody(await nextDate(), "37000.00", `m-${tag}`), key());
    r = await api(P.finance, "POST", PATHS.decide(m.body.id), { decision: "approve" }, key());
    check(`${run}.finance.refused-once-the-permission-is-removed`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "GET", PATHS.read, null, null);
    check(`${run}.finance.cannot-read-once-removed`, r.status === 403, `${r.status}`);
    await api(P.admin, "POST", PATHS.decide(m.body.id), { decision: "withdraw" }, key());

    // 9. Nothing an application uses has moved.
    const after = baseline();
    check(`${run}.real-fee-and-applications-unchanged`, before === after, before === after ? "RAC:new_model, applications and fee snapshots unchanged" : `drift ${before} vs ${after}`);
  } finally {
    sqlMaint(`DELETE FROM app.fee_rule_proposal WHERE proposed_by IN (${twinIds}); DELETE FROM app.capability_grant WHERE capability = 'fee_rule_manage' AND role = 'finance'; DELETE FROM app.fee_application_type WHERE code = 'live_check'`);
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
    await runChecks("feerules.run1", P, who);
    await runChecks("feerules.run2", P, who);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("feerules.run", false, String(e.message)))
  .then(() => {
    console.log(`fee-rules checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
