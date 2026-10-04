/* eslint-disable */
/** First slice step 2: Finance confirms the fee received (fee_due → iame_scrutiny) through the BFF and the portal; baseline-preserving, run twice. */
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

const RUNTIME_FEE = "/api/runtime/model-applications/{id}/fee-confirmation";

const NOVA_COOL = "00000000-0000-4000-d000-000000000001";
const PIXEL_APP = "00000000-0000-4000-c000-000000000003";
const NOVA_FEE_DUE = "00000000-0000-4000-c000-000000000002";
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
const confirmBody = (version, extra = {}) => ({ version, receiptReference: `UTR-${Date.now().toString(36)}`, receivedOn: RECEIVED_ON, amountInr: "24000.00", ...extra });

function recordFee(status, code, r) {
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route: RUNTIME_FEE, method: "POST", status, code: code ?? "-", ok: contract.conforms(doc, RUNTIME_FEE, "POST", faux).length === 0 });
}

/** POST a confirmation and record the contract observation. */
async function confirmApi(page, id, body, idem) {
  const r = await api(page, "POST", feeUrl(id), body, idem);
  recordFee(r.status, r.status >= 400 ? r.body?.error : "-", r);
  return r;
}

async function setInput(page, testId, value) {
  await page.eval(`(() => {
    const el = document.querySelector('[data-testid=${testId}]');
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
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

// jsonb storage reorders object keys, so a replayed body is compared by content, not by serialisation order.
const sameBody = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
const countOf = (table, id) => Number(sql(`SELECT count(*) FROM app.${table} WHERE application_id = '${id}'`));
const stateOf = (id) => sql(`SELECT state FROM app.model_application WHERE id = '${id}'`);

async function runFeeChecks(runLabel, nova, finance) {
  const createdIds = [];
  const before = modelBaseline();
  const blobsBefore = blobsNow();
  const tag = `${runLabel}-${Date.now()}`;
  try {
    const draftOnly = await api(nova, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: `FC-DRAFT-${tag}` }, key());
    if (draftOnly.body?.id) createdIds.push(draftOnly.body.id);
    const A = await submittedApp(nova, createdIds, `FC-A-${tag}`);
    check(`${runLabel}.nova.submitted`, A.ok, `${A.reference} ${A.id ? stateOf(A.id) : "-"}`);

    // What Finance may see: only fee_due applications, with the fee.
    let r = await api(finance, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    const items = r.body?.items ?? [];
    check(`${runLabel}.finance.list-scope`, r.status === 200 && items.length > 0 && items.every((x) => x.state === "fee_due") && items.some((x) => x.id === A.id) && !items.some((x) => x.id === draftOnly.body?.id), `${items.length} fee_due record(s), no drafts`);
    r = await api(finance, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    check(`${runLabel}.finance.detail-fee`, r.status === 200 && r.body?.submissionFee?.amountInr === "24000.00" && r.body?.laboratoryCode === "LAB", `${r.body?.submissionFee?.amountInr} ${r.body?.laboratoryCode}`);

    // Refusals leave the application exactly as it was.
    r = await confirmApi(nova, A.id, confirmBody(A.version), key());
    check(`${runLabel}.nova.cannot-confirm`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error ?? ""}`);
    r = await confirmApi(finance, A.id, confirmBody(A.version, { amountInr: "23999.00" }), key());
    check(`${runLabel}.finance.amount-mismatch`, r.status === 422 && r.body?.error === "amount_mismatch", `${r.status} ${r.body?.error ?? ""}`);
    r = await confirmApi(finance, A.id, confirmBody(A.version, { receivedOn: "2999-01-01" }), key());
    check(`${runLabel}.finance.future-date`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await confirmApi(finance, A.id, confirmBody(A.version, { receiptReference: "bad;ref" }), key());
    check(`${runLabel}.finance.bad-receipt`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await confirmApi(finance, A.id, confirmBody(A.version), null);
    check(`${runLabel}.finance.missing-key`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error ?? ""}`);
    r = await confirmApi(finance, A.id, confirmBody(A.version + 5), key());
    check(`${runLabel}.finance.stale-version`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.refusals-wrote-nothing`, stateOf(A.id) === "fee_due" && countOf("model_application_transition_event", A.id) === 0 && countOf("model_application_fee_confirmation", A.id) === 0, "still fee_due, no event, no confirmation");

    // The portal: the applicant reaching the Finance screen is refused by Spring, in the screen's own words.
    await nova.goto(`${WEB}/app/finance/finance-queue?id=${encodeURIComponent(A.id)}`);
    const novaForm = await nova.waitFor(`!!document.querySelector('[data-testid=fee-confirm-run]')`, 20000);
    if (novaForm) {
      await setInput(nova, "fee-confirm-receipt", `UI-NOVA-${tag}`.slice(0, 40));
      await setInput(nova, "fee-confirm-received-on", RECEIVED_ON);
      await nova.eval(`document.querySelector('[data-testid=fee-confirm-run]').click(); true`);
    }
    const novaErr = novaForm && (await nova.waitFor(`!!document.querySelector('[data-testid=fee-confirm-error]')`, 12000));
    const novaErrText = novaErr ? await nova.eval(`document.querySelector('[data-testid=fee-confirm-error]').textContent`) : "";
    check(`${runLabel}.ui.nova-refused`, !!novaErr && /cannot perform this action/.test(novaErrText) && stateOf(A.id) === "fee_due", novaErrText.slice(0, 60) || "no error shown");

    // The portal: Finance confirms.
    await finance.goto(`${WEB}/app/finance/finance-queue?id=${encodeURIComponent(A.id)}`);
    const ready = await finance.waitFor(`!!document.querySelector('[data-testid=fee-confirm-run]') && document.querySelector('[data-testid=fee-confirm-amount]').value !== ''`, 20000);
    const shown = ready ? await finance.eval(`({ amount: document.querySelector('[data-testid=fee-confirm-amount]').value, fields: document.querySelector('[data-testid=finance-detail-fields]').textContent, inQueue: !!document.querySelector('[data-testid="finance-ref-${A.reference}"]') })`) : null;
    check(`${runLabel}.ui.finance-detail`, !!shown && shown.amount === "24000.00" && /24,000/.test(shown.fields) && /LAB/.test(shown.fields) && shown.inQueue, shown ? `amount ${shown.amount}, in queue ${shown.inQueue}` : "form did not load");
    if (!ready) return;
    await finance.eval(`document.querySelector('[data-testid=fee-confirm-run]').click(); true`);
    const needInput = await finance.waitFor(`!!document.querySelector('[data-testid=fee-confirm-input-error]')`, 8000);
    check(`${runLabel}.ui.needs-receipt-and-date`, needInput && stateOf(A.id) === "fee_due", "nothing sent without a receipt and a date");
    const receipt = `UTR-UI-${tag}`.slice(0, 40);
    await setInput(finance, "fee-confirm-receipt", receipt);
    await setInput(finance, "fee-confirm-received-on", RECEIVED_ON);
    await finance.eval(`document.querySelector('[data-testid=fee-confirm-run]').click(); true`);
    const done = await finance.waitFor(`!!document.querySelector('[data-testid=fee-confirm-success]')`, 15000);
    const doneText = done ? await finance.eval(`document.querySelector('[data-testid=fee-confirm-success]').textContent`) : "";
    check(`${runLabel}.ui.finance-confirmed`, done && doneText.includes(A.reference) && doneText.includes(receipt) && /iame scrutiny/i.test(doneText), doneText.slice(0, 70) || "no success note");

    // What the confirmation changed, in the database and for each reader.
    check(`${runLabel}.db.state-moved`, stateOf(A.id) === "iame_scrutiny" && sql(`SELECT version FROM app.model_application WHERE id = '${A.id}'`) === String(A.version + 1), `iame_scrutiny v${A.version + 1}`);
    const ev = sql(`SELECT action || ':' || from_state || '>' || to_state || ':' || actor_role FROM app.model_application_transition_event WHERE application_id = '${A.id}'`);
    check(`${runLabel}.db.event`, ev === "confirm_fee:fee_due>iame_scrutiny:finance" && countOf("model_application_transition_event", A.id) === 1, ev);
    const fc = sql(`SELECT receipt_reference || '|' || amount_inr || '|' || received_on FROM app.model_application_fee_confirmation WHERE application_id = '${A.id}'`);
    check(`${runLabel}.db.confirmation`, fc === `${receipt}|24000.00|${RECEIVED_ON}`, fc);
    check(`${runLabel}.db.next-officer-assigned`, sql(`SELECT count(*) FROM app.assignment a JOIN app.role_assignment r ON r.user_id = a.user_id WHERE a.subject_id = '${A.id}' AND a.stage = 'iame_scrutiny' AND a.active AND r.role = 'iame'`) === "1", "one active IAME assignment");
    r = await api(finance, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    const after = await api(finance, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.finance.no-longer-sees-it`, r.status === 404 && r.body?.error === "not_found" && !(after.body?.items ?? []).some((x) => x.id === A.id), "the stage moved on, so Finance's scope no longer includes it");
    r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    check(`${runLabel}.nova.sees-new-state`, r.status === 200 && r.body?.state === "iame_scrutiny", r.body?.state);
    r = await confirmApi(finance, A.id, confirmBody(A.version + 1), key());
    check(`${runLabel}.finance.cannot-confirm-twice`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.db.still-one-event`, countOf("model_application_transition_event", A.id) === 1 && countOf("model_application_fee_confirmation", A.id) === 1, "exactly one event and one confirmation");

    // Idempotency: a lost-response retry replays the receipt; a different body under the same key is refused.
    const B = await submittedApp(nova, createdIds, `FC-B-${tag}`);
    const k = key();
    const body = confirmBody(B.version);
    const first = await confirmApi(finance, B.id, body, k);
    const again = await confirmApi(finance, B.id, body, k);
    check(`${runLabel}.finance.replay`, first.status === 200 && again.status === 200 && again.replay === "true" && sameBody(first.body, again.body) && countOf("model_application_transition_event", B.id) === 1, `replay=${again.replay}`);
    r = await confirmApi(finance, B.id, { ...body, receiptReference: `OTHER-${tag}`.slice(0, 40) }, k);
    check(`${runLabel}.finance.key-conflict`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error ?? ""}`);

    // The seeded fee_due application is Finance's to see but was never touched.
    check(`${runLabel}.seed-untouched`, sql(`SELECT state FROM app.model_application WHERE id = '${NOVA_FEE_DUE}'`) === "fee_due", "seeded LOCAL-MA-0002 still fee_due");
  } finally {
    cleanupDisposable(createdIds);
    for (const f of blobsNow()) {
      if (!blobsBefore.has(f)) {
        try { fs.unlinkSync(path.join(STORE, f)); } catch { /* ignore */ }
      }
    }
    const after = modelBaseline();
    check(`${runLabel}.baseline-preserved`, before === after, before === after ? "seed rows unchanged" : `drift ${before.slice(0, 30)} vs ${after.slice(0, 30)}`);
    const orphans = sql(`SELECT count(*) FROM app.assignment WHERE subject_type = 'model_application' AND subject_id NOT IN (SELECT id FROM app.model_application)`);
    check(`${runLabel}.no-orphan-assignments`, orphans === "0", `orphan assignments=${orphans}`);
  }
}

async function main() {
  const chrome = await launchChrome();
  try {
    const novaTwin = ids.name("nova.applicant");
    const financeTwin = ids.name("bee.finance");
    await totp.ensureEnrolled(novaTwin);
    await totp.ensureEnrolled(financeTwin);
    const nova = await openPage(chrome.cdp);
    if (!(await signIn(nova, novaTwin))) throw new Error("Nova sign-in failed");
    const finance = await openPage(chrome.cdp);
    if (!(await signIn(finance, financeTwin))) throw new Error("Finance sign-in failed");
    await runFeeChecks("fee.run1", nova, finance);
    await runFeeChecks("fee.run2", nova, finance);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("fee.run", false, String(e.message)))
  .then(() => {
    console.log(`fee-confirmation checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
