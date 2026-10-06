/* eslint-disable */
/** Fee-confirmation corrections: Finance confirms a fee with a wrong receipt reference, proposes the right one, a DIFFERENT permission holder approves; the confirmation is never edited; nobody from the paying organisation may decide; one correction waits at a time; the permission follows the role it is granted to. Run twice; the applications are disposable and cleaned. */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { USERS } = require("../../local/generate-fixtures.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");
const contract = require("./contract-lib.cjs");
const doc = contract.load();


const NOVA_COOL = "00000000-0000-4000-d000-000000000001";
const PIXEL_APP = "00000000-0000-4000-c000-000000000003";
const NOVA_FEE_DUE = "00000000-0000-4000-c000-000000000002";
const SEEDED_IAME_APP = "00000000-0000-4000-c000-000000000003";
const REAL_IAME = "00000000-0000-4000-a000-000000000004";
const REAL_REVIEWER = "00000000-0000-4000-a000-000000000005";
const PIXEL_ORG = "00000000-0000-4000-b000-000000000002";
const key = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);

let pass = 0, fail = 0;
function check(id, ok, detail) { const r = ok ? "PASS" : "FAIL"; ok ? pass++ : fail++; console.log(`${r.padEnd(4)} ${id.padEnd(44)} ${detail}`); }

const env = (k, d) => process.env[k] || d;

const STORE = env("BEE_DOCUMENTS_STORE", path.join(__dirname, "../../.local/documents"));
const blobsNow = () => new Set(fs.existsSync(STORE) ? fs.readdirSync(STORE).filter((f) => /^[0-9a-f]{64}$/.test(f)) : []);
// Seeded accreditation history for LAB:RAC: active to 2026-06-01, suspended in June, a gap in July, active again from 2026-08-01.
const TESTED_OK = "2026-09-01";
const TESTED_SUSPENDED = "2026-06-15";
const minPdf = (label) => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<< /Info << /Title (${label}) >> >>\n%%EOF\n`);

function sqlApp(q, allowFail = false) {
  try {
    return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${env("BEE_APP_DB_PASSWORD", "bee-local-app")}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
  } catch (e) {
    if (allowFail) return (e.stderr?.toString() || e.message || "").trim();
    throw e;
  }
}

function sqlMaint(q, allowFail = false) {
  try {
    return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", env("BEE_MAINT_DB_USER", "bee_local_maint"), "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
  } catch (e) {
    if (allowFail) return (e.stderr?.toString() || e.message || "").trim();
    throw e;
  }
}

const sql = sqlApp;
function modelBaseline() {
  return sql("SELECT count(*)::text || '|' || coalesce(string_agg(reference || ':' || state || ':' || version, ',' ORDER BY reference), '') FROM app.model_application");
}

function twinAccountIds() {
  return USERS.map((u) => `'${ids.accountId(u.username)}'`).join(",");
}

function registerDisposable(createdIds) {
  for (const id of createdIds) {
    sqlMaint(
      `SELECT set_config('bee.cleanup_schema', 'app', true); INSERT INTO app.local_disposable_application (application_id) VALUES ('${id}') ON CONFLICT DO NOTHING`,
    );
  }
}

function cleanupDisposable(createdIds) {
  if (createdIds.length) {
    registerDisposable(createdIds);
    const arr = createdIds.map((id) => `'${id}'`).join(",");
    sqlMaint(
      `SELECT set_config('bee.cleanup_schema', 'app', true); SELECT app.app_disposable_model_cleanup(ARRAY[${arr}]::uuid[])`,
    );
  }
  sqlApp(`DELETE FROM app.idempotency_record WHERE account_id IN (${twinAccountIds()})`);
}

async function api(page, method, path, body, idem) {
  const headers = { "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) };
  const bodySnippet = body == null ? "undefined" : `JSON.stringify(${JSON.stringify(body)})`;
  return page.eval(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "include", cache: "no-store", headers: ${JSON.stringify(headers)}, body: ${bodySnippet} }).then(async (r) => { const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; }); return { status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null), headers: hs }; })`);
}

async function patchDraft(page, draft, fields) {
  const r = await api(page, "PATCH", `${WEB}/api/runtime/model-applications/${draft.id}`, { version: draft.version, category: "RAC", modelNumber: draft.model, ...fields }, key());
  if (r.status === 200) draft.version = r.body.version;
  return r;
}

async function uploadReport(page, draftId, label) {
  const b64 = minPdf(label).toString("base64");
  return page.eval(`(async () => {
    const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
    const form = new FormData();
    form.append("file", new File([bin], "report.pdf", { type: "application/pdf" }));
    form.append("documentKind", "test_report");
    form.append("reportLabel", ${JSON.stringify(label)});
    const r = await fetch(${JSON.stringify(`${WEB}/api/runtime/model-applications/`)} + ${JSON.stringify(draftId)} + "/documents", { method: "POST", credentials: "include", cache: "no-store", headers: { "Idempotency-Key": ${JSON.stringify(key())} }, body: form });
    return { status: r.status, body: await r.json().catch(() => null) };
  })()`);
}

async function completeEvidence(page, draft, label) {
  const p = await patchDraft(page, draft, { laboratoryCode: "LAB", testedOn: TESTED_OK, declaredIseer: 4.5 });
  const u = await uploadReport(page, draft.id, label);
  return p.status === 200 && u.status === 201;
}

const DEMO_FEE = { amountInr: "24000.00", feeRuleKey: "RAC:new_model", feeRuleVersion: 2 };
const RECEIVED_ON = "2026-10-02";
const feeUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/fee-confirmation`;
const iameUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/iame-recommendation`;
const reviewerUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/reviewer-forward`;
const ratingUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/rating`;
const secretaryUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/secretary-approval`;
const directorUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/director-recommendation`;
const returnUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/return`;
const resubmitUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/resubmit`;
const rejectUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/reject`;
const RUNTIME_HISTORY = "/api/runtime/model-applications/{id}/history";
const historyUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/history`;

/** GET the history and record the contract observation. */
async function historyApi(page, id) {
  const r = await api(page, "GET", historyUrl(id), null, null);
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route: RUNTIME_HISTORY, method: "GET", status: r.status, code: r.status >= 400 ? (r.body?.error ?? "-") : "-", ok: contract.conforms(doc, RUNTIME_HISTORY, "GET", faux).length === 0 });
  return r;
}

async function setInput(page, testId, value, kind = "HTMLInputElement") {
  await page.eval(`(() => {
    const el = document.querySelector('[data-testid=${testId}]');
    const s = Object.getOwnPropertyDescriptor(window.${kind}.prototype, 'value').set;
    s.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}

/** A model application the applicant has taken all the way to fee_due, with its evidence, through the real API. */
async function submittedApp(page, createdIds, model) {
  let r = await api(page, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: model }, key());
  if (r.body?.id) createdIds.push(r.body.id);
  const draft = { id: r.body?.id, version: r.body?.version, model: r.body?.modelNumber };
  if (!(await completeEvidence(page, draft, `fee-${model}`))) return { ...draft, ok: false };
  const preview = await api(page, "GET", `${WEB}/api/runtime/model-applications/${draft.id}/submit`, null, null);
  r = await api(page, "POST", `${WEB}/api/runtime/model-applications/${draft.id}/submit`, { version: preview.body.version, expectedFee: DEMO_FEE }, key());
  return { id: draft.id, ok: r.status === 200 && r.body?.state === "fee_due", version: r.body?.version, reference: r.body?.reference, model };
}


const PATHS = { read: `${WEB}/api/runtime/fee-corrections`, propose: `${WEB}/api/runtime/fee-corrections/proposals`, decide: (id) => `${WEB}/api/runtime/fee-corrections/proposals/${id}/decision` };
const SCREEN = "/app/finance/receipt";
const REVERSAL_PATHS = { propose: `${WEB}/api/runtime/fee-corrections/reversals`, decide: (id) => `${WEB}/api/runtime/fee-corrections/reversals/${id}/decision` };
const routeOf = (path) =>
  /\/reversals\/[^/]+\/decision$/.test(path) ? "/api/runtime/fee-corrections/reversals/{id}/decision"
    : path.endsWith("/reversals") ? "/api/runtime/fee-corrections/reversals"
      : path.endsWith("/notifications") ? "/api/runtime/notifications"
        : path.endsWith("/decision") ? "/api/runtime/fee-corrections/proposals/{id}/decision"
          : path.endsWith("/proposals") ? "/api/runtime/fee-corrections/proposals" : "/api/runtime/fee-corrections";

/** A request through the browser's session; a fee-correction answer is checked against the artifact and recorded as live evidence. */
async function capi(page, method, path, body, idem) {
  const r = await api(page, method, path, body, idem);
  const route = routeOf(path);
  contract.record({ route, method, status: r.status, code: r.status >= 400 ? (r.body?.error ?? "-") : "-", ok: contract.conforms(doc, route, method, contract.observationFromBrowserFetch(r)).length === 0 });
  return r;
}
const uiClick = (page, testId) => page.eval(`document.querySelector('[data-testid="${testId}"]').click(); true`);
const present = (page, testId, ms = 20000) => page.waitFor(`!!document.querySelector('[data-testid="${testId}"]')`, ms);
const textOf = (page, testId) => page.eval(`document.querySelector('[data-testid="${testId}"]')?.textContent ?? ""`);
async function setInput(page, testId, value, kind = "HTMLInputElement") {
  await page.eval(`(() => {
    const el = document.querySelector('[data-testid=${testId}]');
    const s = Object.getOwnPropertyDescriptor(window.${kind}.prototype, 'value').set;
    s.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}
async function open(page, route, readyTestId) {
  await page.goto(`${WEB}${route}`);
  return present(page, readyTestId, 30000);
}
async function menuOf(page) {
  await page.goto(`${WEB}/app`);
  await present(page, "runtime-nav", 30000);
  return page.eval(`[...document.querySelectorAll('[data-testid^="runtime-nav-"]')].map((e) => e.getAttribute("data-testid").replace("runtime-nav-", ""))`);
}
const PERSONA = { nova: "nova.applicant", finance: "bee.finance", programme: "bee.programme" };
const grant = (role) => sqlMaint(`INSERT INTO app.capability_grant (capability, role) VALUES ('fee_confirmation_correct', '${role}') ON CONFLICT DO NOTHING`);
const revoke = (role) => sqlMaint(`DELETE FROM app.capability_grant WHERE capability = 'fee_confirmation_correct' AND role = '${role}'`);
const rowOf = (id) => sqlApp(`SELECT state || '|' || receipt_reference || '|' || received_on || '|' || coalesce(decision_note, '') FROM app.fee_correction_proposal WHERE id = '${id}'`);
const confirmationRow = (appId) => sqlApp(`SELECT receipt_reference || '|' || received_on || '|' || amount_inr FROM app.model_application_fee_confirmation WHERE application_id = '${appId}'`);

async function pendingFor(page, reference) {
  const r = await capi(page, "GET", PATHS.read, null, null);
  return r.body?.pending?.find((p) => p.reference === reference)?.id ?? null;
}

async function runChecks(run, P) {
  const tag = crypto.randomUUID().slice(0, 6);
  const created = [];
  const before = sqlApp("SELECT count(*) FROM app.model_application");
  try {
    // A submitted, confirmed application whose receipt reference is wrong.
    const app = await submittedApp(P.nova, created, `FC-${tag}`);
    const wrong = `UTR-WRONG-${tag}`;
    const conf = await api(P.finance, "POST", feeUrl(app.id), { version: app.version, receiptReference: wrong, receivedOn: RECEIVED_ON, amountInr: "24000.00" }, key());
    check(`${run}.setup.fee-confirmed-with-a-wrong-reference`, app.ok && conf.status === 200 && conf.body?.toState === "iame_scrutiny", `${conf.status} ${conf.body?.toState}`);
    const original = confirmationRow(app.id);

    // 0. Who sees what.
    const fm = await menuOf(P.finance), nm = await menuOf(P.nova), pm = await menuOf(P.programme);
    check(`${run}.menu.finance-has-the-receipts-screen`, fm.includes("receipt"), fm.join(","));
    check(`${run}.menu.applicant-and-programme-do-not`, !nm.includes("receipt") && !pm.includes("receipt"), `${nm.join(",")} | ${pm.join(",")}`);
    let r = await capi(P.nova, "GET", PATHS.read, null, null);
    check(`${run}.applicant.cannot-read`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await capi(P.programme, "GET", PATHS.read, null, null);
    check(`${run}.programme.cannot-read-until-granted`, r.status === 403, `${r.status}`);

    // 1. Finance sees the confirmation as first written and proposes the right reference in the portal.
    await open(P.finance, SCREEN, "corrections-screen");
    await present(P.finance, `corrections-row-${app.reference}`);
    check(`${run}.finance.sees-the-confirmation`, (await textOf(P.finance, `corrections-receipt-${app.reference}`)) === wrong, wrong);
    const right = `UTR-RIGHT-${tag}`;
    await uiClick(P.finance, `correction-propose-${app.reference}`);
    await present(P.finance, "correction-form");
    await setInput(P.finance, "correction-receipt", right);
    await setInput(P.finance, "correction-date", "2026-10-01");
    await setInput(P.finance, "correction-reason", `ui-${tag}`, "HTMLTextAreaElement");
    await uiClick(P.finance, "correction-propose-run");
    check(`${run}.finance.ui-propose-success`, await present(P.finance, "correction-propose-success", 15000), (await textOf(P.finance, "correction-propose-success")).slice(0, 100));
    const p1 = await pendingFor(P.finance, app.reference);
    check(`${run}.db.pending-and-the-confirmation-untouched`, p1 && (await rowOf(p1)) === `pending|${right}|2026-10-01|` && confirmationRow(app.id) === original, `${p1} ${p1 ? await rowOf(p1) : ""}`);
    await open(P.finance, SCREEN, "corrections-screen");
    await present(P.finance, `corrections-pending-${p1}`);
    const own = await P.finance.eval(`[!!document.querySelector('[data-testid="correction-withdraw-run-${p1}"]'), !!document.querySelector('[data-testid="correction-approve-run-${p1}"]'), !!document.querySelector('[data-testid="corrections-pending-flag-${app.reference}"]')].join(',')`);
    check(`${run}.finance.own-proposal-only-withdraw-and-the-row-says-waiting`, own === "true,false,true", own);
    r = await capi(P.finance, "POST", PATHS.decide(p1), { decision: "approve" }, key());
    check(`${run}.finance.cannot-approve-own`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);
    r = await capi(P.finance, "POST", PATHS.propose, { applicationId: app.id, receiptReference: `UTR-OTHER-${tag}`, receivedOn: "2026-10-01", reason: "second" }, key());
    check(`${run}.finance.one-correction-waits-at-a-time`, r.status === 409 && r.body?.error === "correction_already_pending", `${r.status} ${r.body?.error}`);

    // 2. Input rules.
    for (const [label, b] of [["unchanged", { applicationId: app.id, receiptReference: wrong, receivedOn: RECEIVED_ON, reason: "no change" }],
      ["future-date", { applicationId: app.id, receiptReference: right, receivedOn: "2999-01-01", reason: "x" }], ["bad-reference", { applicationId: app.id, receiptReference: "bad;ref", receivedOn: "2026-10-01", reason: "x" }],
      ["blank-reason", { applicationId: app.id, receiptReference: right, receivedOn: "2026-10-01", reason: "   " }], ["not-a-uuid", { applicationId: "nope", receiptReference: right, receivedOn: "2026-10-01", reason: "x" }]]) {
      r = await capi(P.finance, "POST", PATHS.propose, b, key());
      check(`${run}.finance.refuses-${label}`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    }
    r = await capi(P.finance, "POST", PATHS.propose, { applicationId: crypto.randomUUID(), receiptReference: right, receivedOn: "2026-10-01", reason: "x" }, key());
    check(`${run}.finance.unknown-application-is-not-found`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await capi(P.finance, "POST", PATHS.propose, { applicationId: app.id, receiptReference: right, receivedOn: "2026-10-01", reason: "x" }, null);
    check(`${run}.finance.key-required`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error}`);

    // 3. The applicant's own organisation can never decide, even holding the permission.
    grant("manufacturer");
    r = await capi(P.nova, "POST", PATHS.decide(p1), { decision: "approve" }, key());
    check(`${run}.applicant-organisation.cannot-decide-even-with-the-permission`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);
    r = await capi(P.nova, "POST", PATHS.propose, { applicationId: app.id, receiptReference: `UTR-NOVA-${tag}`, receivedOn: "2026-10-01", reason: "x" }, key());
    check(`${run}.applicant-organisation.cannot-propose-either`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);
    revoke("manufacturer");

    // 4. A different permission holder approves in the portal; the confirmation itself is never edited.
    grant("programme");
    await open(P.programme, SCREEN, "corrections-screen");
    await present(P.programme, `corrections-pending-${p1}`);
    const colleague = await P.programme.eval(`[!!document.querySelector('[data-testid="correction-approve-run-${p1}"]'), !!document.querySelector('[data-testid="correction-reject-run-${p1}"]'), !!document.querySelector('[data-testid="correction-withdraw-run-${p1}"]')].join(',')`);
    check(`${run}.programme.sees-approve-and-reject-not-withdraw`, colleague === "true,true,false", colleague);
    await setInput(P.programme, `correction-note-${p1}`, `checked-${tag}`);
    await uiClick(P.programme, `correction-approve-run-${p1}`);
    check(`${run}.programme.ui-approve-success`, await present(P.programme, `correction-decided-${p1}`, 15000), (await textOf(P.programme, `correction-decided-${p1}`)).slice(0, 100));
    check(`${run}.db.approved-by-the-other-person-and-the-confirmation-untouched`, (await rowOf(p1)) === `approved|${right}|2026-10-01|checked-${tag}` && confirmationRow(app.id) === original
      && sqlApp(`SELECT decided_by = '${ids.accountId(PERSONA.programme)}' AND proposed_by = '${ids.accountId(PERSONA.finance)}' FROM app.fee_correction_proposal WHERE id = '${p1}'`) === "t", `${await rowOf(p1)}`);
    await open(P.finance, SCREEN, "corrections-screen");
    await present(P.finance, `corrections-row-${app.reference}`);
    const shown = await P.finance.eval(`[document.querySelector('[data-testid="corrections-receipt-${app.reference}"]')?.textContent, document.querySelector('[data-testid="corrections-row-${app.reference}"]')?.getAttribute('data-corrected')].join(',')`);
    check(`${run}.finance.sees-the-corrected-value-in-effect`, shown === `${right},true`, shown);
    r = await capi(P.programme, "POST", PATHS.decide(p1), { decision: "approve" }, key());
    check(`${run}.programme.decided-is-final`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);

    // 5. The history shows the correction beside the confirmation, without naming who approved it to the applicant.
    const h = await api(P.nova, "GET", `${WEB}/api/runtime/model-applications/${app.id}/history`, null, null);
    const step = h.body?.items?.find((i) => i.action === "confirm_fee");
    const labels = (step?.facts ?? []).map((f) => `${f.label}=${f.value}`);
    check(`${run}.history.shows-the-correction-to-the-applicant`, labels.includes(`Corrected receipt reference=${right}`) && labels.includes(`Receipt reference=${wrong}`) && !labels.some((l) => l.startsWith("Correction approved by")), labels.join(" ; ").slice(0, 160));

    // 6. A second correction starts from the corrected values; reject and withdraw in the portal.
    const second = `UTR-SECOND-${tag}`;
    const s = await capi(P.finance, "POST", PATHS.propose, { applicationId: app.id, receiptReference: second, receivedOn: "2026-10-01", reason: `second-${tag}` }, key());
    check(`${run}.finance.second-correction-starts-from-the-corrected-value`, s.status === 201 && s.body?.previousReceiptReference === right, `${s.status} previous ${s.body?.previousReceiptReference}`);
    await open(P.programme, SCREEN, "corrections-screen");
    await present(P.programme, `correction-reject-run-${s.body.id}`);
    await setInput(P.programme, `correction-note-${s.body.id}`, `no-${tag}`);
    await uiClick(P.programme, `correction-reject-run-${s.body.id}`);
    check(`${run}.programme.ui-reject-with-note`, await present(P.programme, `correction-decided-${s.body.id}`, 15000) && (await rowOf(s.body.id)) === `rejected|${second}|2026-10-01|no-${tag}`, await rowOf(s.body.id));
    const w = await capi(P.finance, "POST", PATHS.propose, { applicationId: app.id, receiptReference: `UTR-THIRD-${tag}`, receivedOn: "2026-10-01", reason: `third-${tag}` }, key());
    await open(P.finance, SCREEN, "corrections-screen");
    await present(P.finance, `correction-withdraw-run-${w.body.id}`);
    await uiClick(P.finance, `correction-withdraw-run-${w.body.id}`);
    check(`${run}.finance.ui-withdraw`, await present(P.finance, `correction-decided-${w.body.id}`, 15000) && (await rowOf(w.body.id)).startsWith("withdrawn"), await rowOf(w.body.id));
    r = await capi(P.programme, "POST", PATHS.decide(w.body.id), { decision: "approve" }, key());
    check(`${run}.programme.cannot-approve-a-withdrawn-one`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);
    const x = await capi(P.finance, "POST", PATHS.propose, { applicationId: app.id, receiptReference: `UTR-FOURTH-${tag}`, receivedOn: "2026-10-01", reason: `fourth-${tag}` }, key());
    r = await capi(P.programme, "POST", PATHS.decide(x.body.id), { decision: "withdraw" }, key());
    check(`${run}.programme.cannot-withdraw-another's`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    // Replay of a proposal is the same proposal.
    await capi(P.programme, "POST", PATHS.decide(x.body.id), { decision: "reject" }, key());
    const k5 = key();
    const body5 = { applicationId: app.id, receiptReference: `UTR-FIFTH-${tag}`, receivedOn: "2026-10-01", reason: `fifth-${tag}` };
    const a5 = await capi(P.finance, "POST", PATHS.propose, body5, k5), b5 = await capi(P.finance, "POST", PATHS.propose, body5, k5);
    check(`${run}.finance.replay-is-the-same-proposal`, a5.status === 201 && b5.status === 201 && b5.replay === "true" && a5.body?.id === b5.body?.id, `${b5.status} replay=${b5.replay}`);
    r = await capi(P.finance, "POST", PATHS.propose, { ...body5, reason: "other" }, k5);
    check(`${run}.finance.key-reuse-with-other-body-conflicts`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error}`);

    // 7. The permission follows the role it is granted to.
    revoke("programme");
    r = await capi(P.programme, "POST", PATHS.decide(a5.body.id), { decision: "approve" }, key());
    check(`${run}.programme.refused-once-the-permission-is-removed`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    const gone = await menuOf(P.programme);
    check(`${run}.menu.programme-has-no-receipts-entry-once-removed`, !gone.includes("receipt"), gone.join(","));
    await capi(P.finance, "POST", PATHS.decide(a5.body.id), { decision: "withdraw" }, key());
  } finally {
    revoke("manufacturer");
    revoke("programme");
    cleanupDisposable(created);
  }
  const after = sqlApp("SELECT count(*) FROM app.model_application");
  check(`${run}.disposable-applications-and-their-corrections-cleaned`, before === after && sqlApp(`SELECT count(*) FROM app.fee_correction_proposal WHERE proposed_by IN (${twinAccountIds()})`) === "0", `${before} -> ${after}`);
}

/**
 * BL-142 (the owner's assumption B17): Finance proposes reversing a confirmation recorded in error; a DIFFERENT holder approves; the application
 * goes back to fee due, the IAME officer is released, the applicant is told, the confirmation is untouched, and Finance confirms again.
 */
async function runReversalChecks(run, P) {
  const tag = crypto.randomUUID().slice(0, 6);
  const created = [];
  const before = sqlApp("SELECT count(*) FROM app.model_application");
  try {
    const app = await submittedApp(P.nova, created, `FR-${tag}`);
    const wrong = `UTR-NOMONEY-${tag}`;
    const conf = await api(P.finance, "POST", feeUrl(app.id), { version: app.version, receiptReference: wrong, receivedOn: RECEIVED_ON, amountInr: "24000.00" }, key());
    check(`${run}.reversal.setup.fee-confirmed-in-error`, app.ok && conf.status === 200 && conf.body?.toState === "iame_scrutiny", `${conf.status} ${conf.body?.toState}`);
    const stateOf = () => sqlApp(`SELECT state || '|' || version FROM app.model_application WHERE id = '${app.id}'`);
    const v0 = Number(sqlApp(`SELECT version FROM app.model_application WHERE id = '${app.id}'`));
    const officer = () => sqlApp(`SELECT count(*) FROM app.assignment WHERE subject_id = '${app.id}' AND stage = 'iame_scrutiny' AND active`);
    const confirmations = () => sqlApp(`SELECT count(*) || '|' || string_agg(receipt_reference, ',') FROM app.model_application_fee_confirmation WHERE application_id = '${app.id}'`);
    check(`${run}.reversal.setup.officer-assigned`, stateOf() === `iame_scrutiny|${v0}` && officer() === "1" && confirmations() === `1|${wrong}`, `${stateOf()} officer ${officer()} ${confirmations()}`);
    grant("programme");

    // 1. Finance proposes in the portal.
    await open(P.finance, SCREEN, "corrections-screen");
    check(`${run}.reversal.finance.sees-the-reverse-action`, await present(P.finance, `reversal-propose-${app.reference}`), "Reverse is offered while the application is in IAME scrutiny");
    await uiClick(P.finance, `reversal-propose-${app.reference}`);
    await present(P.finance, "reversal-form");
    await uiClick(P.finance, "reversal-propose-run");
    check(`${run}.reversal.finance.ui-refuses-an-empty-reason`, await present(P.finance, "reversal-propose-input-error", 5000), "nothing is sent without a reason");
    await setInput(P.finance, "reversal-reason", `ui-${tag}`, "HTMLTextAreaElement");
    await uiClick(P.finance, "reversal-propose-run");
    check(`${run}.reversal.finance.ui-propose-success`, await present(P.finance, "reversal-propose-success", 15000), (await textOf(P.finance, "reversal-propose-success")).slice(0, 90));
    const rid = sqlApp(`SELECT id FROM app.fee_reversal_proposal WHERE application_id = '${app.id}' AND state = 'pending'`);
    check(`${run}.reversal.db.pending-and-nothing-moved`, !!rid && stateOf() === `iame_scrutiny|${v0}` && officer() === "1", `${rid} ${stateOf()}`);

    // 2. The same person cannot approve; a second proposal and a correction are refused while one waits.
    let r = await capi(P.finance, "POST", REVERSAL_PATHS.decide(rid), { decision: "approve" }, key());
    check(`${run}.reversal.finance.cannot-approve-their-own`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);
    r = await capi(P.finance, "POST", REVERSAL_PATHS.propose, { applicationId: app.id, reason: "again" }, key());
    check(`${run}.reversal.finance.second-reversal-conflicts`, r.status === 409 && r.body?.error === "reversal_already_pending", `${r.status} ${r.body?.error}`);
    r = await capi(P.finance, "POST", PATHS.propose, { applicationId: app.id, receiptReference: `UTR-X-${tag}`, receivedOn: "2026-10-01", reason: "x" }, key());
    check(`${run}.reversal.finance.correction-conflicts-while-a-reversal-waits`, r.status === 409 && r.body?.error === "reversal_already_pending", `${r.status} ${r.body?.error}`);
    r = await capi(P.nova, "POST", REVERSAL_PATHS.propose, { applicationId: app.id, reason: "mine" }, key());
    check(`${run}.reversal.applicant.cannot-propose`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);

    // 3. A different holder approves in the portal.
    await open(P.programme, SCREEN, "corrections-screen");
    check(`${run}.reversal.programme.sees-it-waiting`, await present(P.programme, `reversals-pending-${rid}`, 20000), "listed for the second person");
    await present(P.programme, `reversal-approve-run-${rid}`);
    await uiClick(P.programme, `reversal-approve-run-${rid}`);
    check(`${run}.reversal.programme.ui-approve`, await present(P.programme, `reversal-decided-${rid}`, 15000) && (await textOf(P.programme, `reversal-decided-${rid}`)).includes("back at fee due"), (await textOf(P.programme, `reversal-decided-${rid}`)).slice(0, 100));
    check(`${run}.reversal.db.back-at-fee-due-officer-released`, stateOf() === `fee_due|${v0 + 1}` && officer() === "0", `${stateOf()} officer ${officer()}`);
    check(`${run}.reversal.db.event-and-record`, sqlApp(`SELECT action || ':' || from_state || '>' || to_state || ':' || actor_role FROM app.model_application_transition_event WHERE application_id = '${app.id}' AND action = 'reverse_fee'`) === "reverse_fee:iame_scrutiny>fee_due:programme"
      && sqlApp(`SELECT state || '|' || (transition_event_id IS NOT NULL) FROM app.fee_reversal_proposal WHERE id = '${rid}'`) === "approved|true", "one reverse_fee step; the proposal approved and tied to it");
    check(`${run}.reversal.db.confirmation-untouched`, confirmations() === `1|${wrong}`, confirmations());

    // 4. The applicant is told without Finance's reason; officers read the reason in the history.
    const note = await capi(P.nova, "GET", `${WEB}/api/runtime/notifications`, null, null);
    const told = (note.body?.items ?? []).filter((i) => i.applicationId === app.id && /fee due again/.test(i.message));
    check(`${run}.reversal.applicant.is-told-the-fee-is-due-again`, note.status === 200 && told.length === 1 && told[0].kind === "fee_due" && !told[0].message.includes(`ui-${tag}`), told[0]?.message?.slice(0, 110) ?? "none");
    const hOfficer = await historyApi(P.finance, app.id), hApplicant = await historyApi(P.nova, app.id);
    const evO = hOfficer.body?.items?.find((x) => x.action === "reverse_fee"), evA = hApplicant.body?.items?.find((x) => x.action === "reverse_fee");
    check(`${run}.reversal.history.officer-reads-the-reason-applicant-does-not`, evO?.note === `ui-${tag}` && !!evA && evA.note === undefined && evA.actorName === undefined, `officer note ${evO?.note}; applicant note ${evA?.note}`);

    // 5. The screen shows the reversed confirmation as history; Finance confirms again; the new one is in effect.
    await open(P.finance, SCREEN, "corrections-screen");
    check(`${run}.reversal.ui.reversed-confirmation-is-history`, await present(P.finance, `corrections-reversed-row-${app.reference}`, 15000) && (await textOf(P.finance, `reversed-flag-${app.reference}`)).startsWith("Reversed by"), await textOf(P.finance, `reversed-flag-${app.reference}`));
    const again = `UTR-AGAIN-${tag}`;
    const cur = sqlApp(`SELECT version FROM app.model_application WHERE id = '${app.id}'`);
    r = await api(P.finance, "POST", feeUrl(app.id), { version: Number(cur), receiptReference: again, receivedOn: RECEIVED_ON, amountInr: "24000.00" }, key());
    check(`${run}.reversal.finance.confirms-again`, r.status === 200 && r.body?.toState === "iame_scrutiny" && officer() === "1" && confirmations() === `2|${wrong},${again}`, `${r.status} ${r.body?.toState} officer ${officer()} ${confirmations()}`);
    await open(P.finance, SCREEN, "corrections-screen");
    check(`${run}.reversal.ui.new-confirmation-is-in-effect`, (await present(P.finance, `corrections-row-${app.reference}`, 15000)) && (await textOf(P.finance, `corrections-receipt-${app.reference}`)) === again, again);
    r = await capi(P.programme, "POST", REVERSAL_PATHS.decide(rid), { decision: "approve" }, key());
    check(`${run}.reversal.programme.cannot-decide-twice`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);
    r = await capi(P.finance, "POST", REVERSAL_PATHS.decide(crypto.randomUUID()), { decision: "approve" }, key());
    check(`${run}.reversal.unknown-reversal-is-404`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    // A rejected reversal changes nothing.
    r = await capi(P.finance, "POST", REVERSAL_PATHS.propose, { applicationId: app.id, reason: `second-${tag}` }, key());
    const rid2 = r.body?.id;
    const stateBefore = stateOf();
    r = await capi(P.programme, "POST", REVERSAL_PATHS.decide(rid2), { decision: "reject", note: `keep-${tag}` }, key());
    check(`${run}.reversal.programme.reject-changes-nothing`, r.status === 200 && r.body?.state === "rejected" && stateOf() === stateBefore && officer() === "1", `${r.status} ${r.body?.state} ${stateOf()}`);
    revoke("programme");
    r = await capi(P.programme, "POST", REVERSAL_PATHS.propose, { applicationId: app.id, reason: "late" }, key());
    check(`${run}.reversal.programme.refused-once-the-permission-is-removed`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
  } finally {
    revoke("programme");
    cleanupDisposable(created);
  }
  const after = sqlApp("SELECT count(*) FROM app.model_application");
  check(`${run}.reversal.disposable-applications-and-their-reversals-cleaned`, before === after && sqlApp(`SELECT count(*) FROM app.fee_reversal_proposal WHERE proposed_by IN (${twinAccountIds()})`) === "0", `${before} -> ${after}`);
}

async function main() {
  const chrome = await launchChrome();
  try {
    const who = Object.fromEntries(Object.entries(PERSONA).map(([k, p]) => [k, ids.name(p)]));
    const P = {};
    for (const [k, u] of Object.entries(who)) {
      await totp.ensureEnrolled(u);
      P[k] = await openPage(chrome.cdp);
      if (!(await signIn(P[k], u))) throw new Error(`${k} sign-in failed`);
    }
    await runChecks("corrections.run1", P);
    await runReversalChecks("corrections.run1", P);
    await runChecks("corrections.run2", P);
    await runReversalChecks("corrections.run2", P);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("corrections.run", false, String(e.message)))
  .then(() => {
    console.log(`fee-corrections checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
