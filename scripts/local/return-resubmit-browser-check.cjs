/* eslint-disable */
/** Wave 1: a stage owner returns an application with a reason, the applicant edits and resubmits, and it goes back to the stage that returned it (or through rating again when a rating input changed) through the BFF and the portal; baseline-preserving, run twice. */
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

const RUNTIME_RETURN = "/api/runtime/model-applications/{id}/return";
const RUNTIME_RESUBMIT = "/api/runtime/model-applications/{id}/resubmit";

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
const REASON = "The laboratory name on the report does not match the application.";

function recordRoute(route, r) {
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route, method: "POST", status: r.status, code: r.status >= 400 ? (r.body?.error ?? "-") : "-", ok: contract.conforms(doc, route, "POST", faux).length === 0 });
}

/** POST a return and record the contract observation. */
async function returnApi(page, id, body, idem) {
  const r = await api(page, "POST", returnUrl(id), body, idem);
  recordRoute(RUNTIME_RETURN, r);
  return r;
}

/** POST a resubmission and record the contract observation. */
async function resubmitApi(page, id, body, idem) {
  const r = await api(page, "POST", resubmitUrl(id), body, idem);
  recordRoute(RUNTIME_RESUBMIT, r);
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

/** An application taken up to the given stage through the real API, one person per step. */
async function chainTo(stage, p, createdIds, model) {
  const app = await submittedApp(p.nova, createdIds, model);
  if (!app.ok) return { ...app, ok: false };
  const f = await api(p.finance, "POST", feeUrl(app.id), { version: app.version, receiptReference: `UTR-${Date.now().toString(36)}`, receivedOn: RECEIVED_ON, amountInr: "24000.00" }, key());
  if (!(f.status === 200 && f.body?.toState === "iame_scrutiny")) return { ...app, ok: false };
  let version = f.body.version;
  const done = () => ({ ...app, ok: true, version });
  if (stage === "iame_scrutiny") return done();
  const q = await api(p.iame, "POST", iameUrl(app.id), { version, verification: "verified", note: "Report matches the declared laboratory and date." }, key());
  if (!(q.status === 200 && q.body?.toState === "bee_scrutiny")) return { ...app, ok: false };
  version = q.body.version;
  if (stage === "bee_scrutiny") return done();
  const w = await api(p.reviewer, "POST", reviewerUrl(app.id), { version, note: "Checked against the application and the IAME note." }, key());
  if (!(w.status === 200 && w.body?.toState === "rating")) return { ...app, ok: false };
  const g = await api(p.programme, "POST", ratingUrl(app.id), { version: w.body.version, verifiedIseer: "4.62" }, key());
  if (!(g.status === 200 && g.body?.toState === "director_review")) return { ...app, ok: false };
  version = g.body.version;
  if (stage === "director_review") return done();
  const d = await api(p.director, "POST", directorUrl(app.id), { version, note: "Rating reviewed; recommend approval." }, key());
  if (!(d.status === 200 && d.body?.toState === "secretary_approval")) return { ...app, ok: false };
  version = d.body.version;
  return done();
}

// jsonb storage reorders object keys, so a replayed body is compared by content, not by serialisation order.
const sameBody = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
const countOf = (table, id) => Number(sql(`SELECT count(*) FROM app.${table} WHERE application_id = '${id}'`));
const stateOf = (id) => sql(`SELECT state FROM app.model_application WHERE id = '${id}'`);

const uiClick = (page, testId) => page.eval(`document.querySelector('[data-testid=${testId}]').click(); true`);
const present = (page, testId, ms = 20000) => page.waitFor(`!!document.querySelector('[data-testid=${testId}]')`, ms);
const textOf = (page, testId) => page.eval(`document.querySelector('[data-testid=${testId}]')?.textContent ?? ""`);

async function runReworkChecks(runLabel, P) {
  const createdIds = [];
  const before = modelBaseline();
  const blobsBefore = blobsNow();
  const tag = `${runLabel}-${Date.now()}`;
  const returnRow = (id) => sql(`SELECT returned_from_state || '|' || reason || '|' || fp_declared_iseer || '|' || fp_report_versions FROM app.model_application_return WHERE application_id = '${id}' ORDER BY returned_at DESC LIMIT 1`);
  const resubRow = (id) => sql(`SELECT resumed_state || '|' || rating_superseded FROM app.model_application_resubmission WHERE application_id = '${id}' ORDER BY resubmitted_at DESC LIMIT 1`);
  const assigned = (id, stage) => Number(sql(`SELECT count(*) FROM app.assignment WHERE subject_id = '${id}' AND stage = '${stage}' AND active`));
  const actions = (id) => sql(`SELECT string_agg(action, ',' ORDER BY version_after) FROM app.model_application_transition_event WHERE application_id = '${id}'`);
  try {
    // ---------------- Scenario A: the IAME officer returns; the applicant fixes it in the real form and resubmits ----------------
    const A = await chainTo("iame_scrutiny", P, createdIds, `RW-A-${tag}`);
    check(`${runLabel}.A.setup`, A.ok && stateOf(A.id) === "iame_scrutiny" && assigned(A.id, "iame_scrutiny") === 1, `${A.reference} ${A.id ? stateOf(A.id) : "-"}`);
    let r = await returnApi(P.nova, A.id, { version: A.version, reason: REASON }, key());
    check(`${runLabel}.A.applicant-cannot-return`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error ?? ""}`);
    r = await returnApi(P.finance, A.id, { version: A.version, reason: REASON }, key());
    check(`${runLabel}.A.finance-cannot-see-it`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    for (const [label, bad] of [["empty", "   "], ["control-characters", "line one\nline two"], ["long", "x".repeat(501)]]) {
      r = await returnApi(P.iame, A.id, { version: A.version, reason: bad }, key());
      check(`${runLabel}.A.bad-reason.${label}`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    }
    r = await returnApi(P.iame, A.id, { version: A.version, reason: REASON }, null);
    check(`${runLabel}.A.missing-key`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error ?? ""}`);
    r = await returnApi(P.iame, A.id, { version: A.version + 5, reason: REASON }, key());
    check(`${runLabel}.A.stale-version`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.A.refusals-wrote-nothing`, stateOf(A.id) === "iame_scrutiny" && countOf("model_application_return", A.id) === 0, "still iame_scrutiny, no return record");

    // The officer returns it through the real screen.
    await P.iame.goto(`${WEB}/app/model-label/iame-scrutiny?id=${encodeURIComponent(A.id)}`);
    const iameReady = await present(P.iame, "iame-return-run");
    if (!iameReady) return;
    await uiClick(P.iame, "iame-return-run");
    check(`${runLabel}.A.ui.return-needs-reason`, await present(P.iame, "iame-return-input-error", 8000) && stateOf(A.id) === "iame_scrutiny", "nothing sent without a reason");
    await setInput(P.iame, "iame-return-reason", REASON, "HTMLTextAreaElement");
    await uiClick(P.iame, "iame-return-run");
    const iameDone = await present(P.iame, "iame-return-success", 15000);
    const iameText = iameDone ? await textOf(P.iame, "iame-return-success") : "";
    check(`${runLabel}.A.ui.iame-returned`, iameDone && iameText.includes(A.reference) && /returned/.test(iameText), iameText.slice(0, 90) || "no success note");
    check(`${runLabel}.A.db.returned`, stateOf(A.id) === "returned" && returnRow(A.id) === `iame_scrutiny|${REASON}|4.50|1`, returnRow(A.id));
    check(`${runLabel}.A.db.event-and-assignment-kept`, actions(A.id) === "confirm_fee,return" && assigned(A.id, "iame_scrutiny") === 1, "a return event, and the officer's assignment is kept");
    r = await api(P.iame, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    const iameList = await api(P.iame, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.A.iame-no-longer-sees-it`, r.status === 404 && !(iameList.body?.items ?? []).some((x) => x.id === A.id), "while it is with the applicant the officer cannot read it");

    // The applicant sees why, and fixes it in the real form.
    r = await api(P.nova, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    check(`${runLabel}.A.nova.sees-why`, r.status === 200 && r.body?.state === "returned" && r.body?.returnNote?.fromState === "iame_scrutiny" && r.body?.returnNote?.reason === REASON, `${r.body?.state}, from ${r.body?.returnNote?.fromState}`);
    const novaList = await api(P.nova, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.A.list-carries-no-return-note`, (novaList.body?.items ?? []).some((x) => x.id === A.id && x.state === "returned") && (novaList.body?.items ?? []).every((x) => x.returnNote === undefined), "the reason is on the detail read only");
    await P.nova.goto(`${WEB}/app/model-label/model-dashboard?id=${encodeURIComponent(A.id)}`);
    const dashReady = await present(P.nova, "model-app-return-reason");
    const dashReason = dashReady ? await textOf(P.nova, "model-app-return-reason") : "";
    const dashEdit = dashReady ? await textOf(P.nova, "model-app-detail-edit") : "";
    check(`${runLabel}.A.ui.dashboard-shows-reason`, dashReady && dashReason === REASON && /Edit and resubmit/.test(dashEdit), `${dashReason.slice(0, 40)}…; link "${dashEdit.trim().slice(0, 20)}"`);
    await P.nova.goto(`${WEB}/app/model-label/new-model-application?edit=${encodeURIComponent(A.id)}`);
    const formReady = await present(P.nova, "model-returned-banner") && (await P.nova.waitFor(`document.querySelector('[data-testid=model-draft-iseer]')?.value === "4.5"`, 15000));
    const formState = formReady ? await P.nova.eval(`({ reason: document.querySelector('[data-testid=model-returned-reason]').textContent, brandOff: document.querySelector('[data-testid=model-draft-brand]').disabled, modelOff: document.querySelector('[data-testid=model-draft-model-number]').disabled, resubmit: !!document.querySelector('[data-testid=model-resubmit-run]'), review: !!document.querySelector('[data-testid=model-draft-submit]') })`) : null;
    check(`${runLabel}.A.ui.form-explains-and-locks-identity`, !!formState && formState.reason === REASON && formState.brandOff && formState.modelOff && formState.resubmit && !formState.review, formState ? "reason shown, brand and model locked, Resubmit offered instead of Submit" : "form did not load");
    if (!formReady) return;
    await setInput(P.nova, "model-draft-iseer", "4.60");
    const dirtyHint = await present(P.nova, "model-resubmit-dirty-hint", 8000);
    await uiClick(P.nova, "model-resubmit-run");
    check(`${runLabel}.A.ui.must-save-before-resubmitting`, dirtyHint && stateOf(A.id) === "returned", "an unsaved change blocks Resubmit");
    await uiClick(P.nova, "model-draft-save");
    const saved = await P.nova.waitFor(`document.querySelector('[data-testid=model-resubmit-dirty-hint]') === null`, 15000);
    check(`${runLabel}.A.db.edit-saved-while-returned`, saved && sql(`SELECT declared_iseer FROM app.model_application WHERE id = '${A.id}'`) === "4.60" && stateOf(A.id) === "returned", "declared efficiency 4.60 saved; still returned");
    r = await api(P.nova, "PATCH", `${WEB}/api/runtime/model-applications/${A.id}`, { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${A.id}'`)), category: "RAC", modelNumber: `CHANGED-${tag}` }, key());
    check(`${runLabel}.A.model-number-locked`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    await uiClick(P.nova, "model-resubmit-run");
    const resubDone = await present(P.nova, "model-resubmit-success", 15000);
    const resubText = resubDone ? await textOf(P.nova, "model-resubmit-success") : "";
    check(`${runLabel}.A.ui.resubmitted`, resubDone && /iame scrutiny/i.test(resubText) && !/rating is replaced/.test(resubText), resubText.slice(0, 90) || "no success note");
    check(`${runLabel}.A.db.back-at-iame`, stateOf(A.id) === "iame_scrutiny" && resubRow(A.id) === "iame_scrutiny|false" && actions(A.id) === "confirm_fee,return,resubmit", `${stateOf(A.id)}, ${resubRow(A.id)}`);
    r = await api(P.iame, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.A.same-officer-sees-it-again`, (r.body?.items ?? []).some((x) => x.id === A.id), "the assignment was kept, so the officer who returned it sees it again");
    r = await api(P.nova, "PATCH", `${WEB}/api/runtime/model-applications/${A.id}`, { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${A.id}'`)), category: "RAC", modelNumber: A.model, declaredIseer: 4.1 }, key());
    check(`${runLabel}.A.no-edit-after-resubmission`, r.status === 403 && r.body?.error === "not_editable", `${r.status} ${r.body?.error ?? ""}`);
    r = await resubmitApi(P.nova, A.id, { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${A.id}'`)) }, key());
    check(`${runLabel}.A.cannot-resubmit-twice`, r.status === 403 && r.body?.error === "not_returned", `${r.status} ${r.body?.error ?? ""}`);
    r = await api(P.iame, "POST", iameUrl(A.id), { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${A.id}'`)), verification: "verified", note: "Corrected report now matches." }, key());
    check(`${runLabel}.A.the-officer-who-returned-it-can-recommend`, r.status === 200 && r.body?.toState === "bee_scrutiny", `${r.status} ${r.body?.toState ?? r.body?.error}`);

    // ---------------- Scenario B: the Reviewer returns; resubmitted unchanged, it goes back to the Reviewer ----------------
    const B = await chainTo("bee_scrutiny", P, createdIds, `RW-B-${tag}`);
    await P.reviewer.goto(`${WEB}/app/model-label/bee-scrutiny?id=${encodeURIComponent(B.id)}`);
    if (!(await present(P.reviewer, "reviewer-return-run"))) { check(`${runLabel}.B.ui.loaded`, false, "reviewer screen did not load"); return; }
    await setInput(P.reviewer, "reviewer-return-reason", "The report is missing the test conditions page.", "HTMLTextAreaElement");
    await uiClick(P.reviewer, "reviewer-return-run");
    const revDone = await present(P.reviewer, "reviewer-return-success", 15000);
    check(`${runLabel}.B.ui.reviewer-returned`, revDone && stateOf(B.id) === "returned" && returnRow(B.id).startsWith("bee_scrutiny|"), returnRow(B.id).slice(0, 60));
    r = await resubmitApi(P.nova, B.id, { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${B.id}'`)), note: "Nothing to change; the page was in the file." }, key());
    check(`${runLabel}.B.resubmitted-to-the-reviewer`, r.status === 200 && r.body?.toState === "bee_scrutiny" && r.body?.ratingSuperseded === false && assigned(B.id, "bee_scrutiny") === 1, `${r.status} -> ${r.body?.toState}`);
    r = await api(P.reviewer, "POST", reviewerUrl(B.id), { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${B.id}'`)), note: "Now complete." }, key());
    check(`${runLabel}.B.the-reviewer-who-returned-it-can-forward`, r.status === 200 && r.body?.toState === "rating", `${r.status} ${r.body?.toState ?? r.body?.error}`);

    // ---------------- Scenario C: the Director returns; a rating input changes, so the rating is redone ----------------
    const C = await chainTo("director_review", P, createdIds, `RW-C-${tag}`);
    await P.director.goto(`${WEB}/app/model-label/director-approval?id=${encodeURIComponent(C.id)}`);
    if (!(await present(P.director, "director-return-run"))) { check(`${runLabel}.C.ui.loaded`, false, "director screen did not load"); return; }
    await setInput(P.director, "director-return-reason", "The declared efficiency looks too low for this model.", "HTMLTextAreaElement");
    await uiClick(P.director, "director-return-run");
    check(`${runLabel}.C.ui.director-returned`, (await present(P.director, "director-return-success", 15000)) && stateOf(C.id) === "returned" && returnRow(C.id).startsWith("director_review|"), returnRow(C.id).slice(0, 70));
    r = await patchDraft(P.nova, { id: C.id, version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${C.id}'`)), model: C.model }, { laboratoryCode: "LAB", testedOn: TESTED_OK, declaredIseer: 4.8 });
    check(`${runLabel}.C.applicant-corrects-the-figure`, r.status === 200 && sql(`SELECT declared_iseer FROM app.model_application WHERE id = '${C.id}'`) === "4.80", `${r.status}, declared 4.80`);
    r = await resubmitApi(P.nova, C.id, { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${C.id}'`)) }, key());
    check(`${runLabel}.C.goes-back-through-rating`, r.status === 200 && r.body?.toState === "rating" && r.body?.ratingSuperseded === true && resubRow(C.id) === "rating|true", `${r.status} -> ${r.body?.toState}, superseded ${r.body?.ratingSuperseded}`);
    r = await api(P.director, "GET", `${WEB}/api/runtime/model-applications/${C.id}`, null, null);
    check(`${runLabel}.C.director-cannot-decide-on-the-old-rating`, r.status === 404, "while it is back in rating the Director cannot read it, so cannot recommend on a rating that no longer matches");
    r = await api(P.programme, "POST", ratingUrl(C.id), { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${C.id}'`)), verifiedIseer: "4.85" }, key());
    check(`${runLabel}.C.programme-rates-again`, r.status === 200 && r.body?.ratingVersion === 2 && r.body?.stars === 4 && r.body?.declaredIseer === "4.80", `${r.status} rating v${r.body?.ratingVersion}, declared ${r.body?.declaredIseer}`);
    check(`${runLabel}.C.db.both-ratings-kept`, sql(`SELECT string_agg(rating_version || ':' || declared_iseer || ':' || verified_iseer, ',' ORDER BY rating_version) FROM app.model_application_rating WHERE application_id = '${C.id}'`) === "1:4.50:4.62,2:4.80:4.85", "the earlier rating stays as version 1");
    r = await api(P.nova, "GET", `${WEB}/api/runtime/model-applications/${C.id}`, null, null);
    check(`${runLabel}.C.detail-shows-the-latest-rating`, r.status === 200 && r.body?.rating?.ratingVersion === 2 && r.body?.rating?.verifiedIseer === "4.85", `rating v${r.body?.rating?.ratingVersion}`);
    r = await api(P.director, "POST", directorUrl(C.id), { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${C.id}'`)), note: "The corrected rating is fine; recommend approval." }, key());
    check(`${runLabel}.C.the-director-who-returned-it-can-recommend`, r.status === 200 && r.body?.toState === "secretary_approval", `${r.status} ${r.body?.toState ?? r.body?.error}`);

    // ---------------- Scenario D: the Secretary returns; resubmitted unchanged, it goes back and is approved ----------------
    const D = await chainTo("secretary_approval", P, createdIds, `RW-D-${tag}`);
    await P.secretary.goto(`${WEB}/app/model-label/director-approval?id=${encodeURIComponent(D.id)}`);
    if (!(await present(P.secretary, "secretary-return-run"))) { check(`${runLabel}.D.ui.loaded`, false, "secretary screen did not load"); return; }
    await setInput(P.secretary, "secretary-return-reason", "Please confirm the laboratory accreditation date.", "HTMLTextAreaElement");
    await uiClick(P.secretary, "secretary-return-run");
    check(`${runLabel}.D.ui.secretary-returned`, (await present(P.secretary, "director-return-success", 15000)) && stateOf(D.id) === "returned" && returnRow(D.id).startsWith("secretary_approval|"), returnRow(D.id).slice(0, 70));
    r = await resubmitApi(P.nova, D.id, { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${D.id}'`)) }, key());
    check(`${runLabel}.D.back-at-the-secretary-without-a-new-rating`, r.status === 200 && r.body?.toState === "secretary_approval" && r.body?.ratingSuperseded === false && countOf("model_application_rating", D.id) === 1, `${r.status} -> ${r.body?.toState}, ${countOf("model_application_rating", D.id)} rating`);
    r = await api(P.secretary, "POST", `${WEB}/api/runtime/model-applications/${D.id}/secretary-approval`, { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${D.id}'`)), note: "Confirmed; approved." }, key());
    check(`${runLabel}.D.then-approved`, r.status === 200 && r.body?.toState === "approved" && stateOf(D.id) === "approved", `${r.status} ${r.body?.toState ?? r.body?.error}`);
    check(`${runLabel}.D.db.whole-history`, actions(D.id) === "confirm_fee,iame_recommend,reviewer_forward,compute_rating,director_recommend,return,resubmit,secretary_approve", actions(D.id));
    r = await resubmitApi(P.nova, D.id, { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${D.id}'`)) }, key());
    check(`${runLabel}.D.approved-cannot-be-resubmitted`, r.status === 403 && r.body?.error === "not_returned", `${r.status} ${r.body?.error ?? ""}`);
    r = await resubmitApi(P.finance, D.id, { version: 1 }, key());
    check(`${runLabel}.D.only-a-filer-resubmits`, r.status === 403 && r.body?.error === "no_write_scope", `${r.status} ${r.body?.error ?? ""}`);

    // ---------------- Scenario E: idempotency. A lost-response retry replays the receipt; a different body under the same key is refused ----------------
    const E = await chainTo("iame_scrutiny", P, createdIds, `RW-E-${tag}`);
    const kr = key();
    const retBody = { version: E.version, reason: "Please attach the full report." };
    const firstReturn = await returnApi(P.iame, E.id, retBody, kr);
    const againReturn = await returnApi(P.iame, E.id, retBody, kr);
    check(`${runLabel}.E.return-replay`, firstReturn.status === 200 && firstReturn.body?.toState === "returned" && againReturn.status === 200 && againReturn.replay === "true" && sameBody(firstReturn.body, againReturn.body) && countOf("model_application_return", E.id) === 1, `replay=${againReturn.replay}`);
    r = await returnApi(P.iame, E.id, { ...retBody, reason: "A different reason." }, kr);
    check(`${runLabel}.E.return-key-conflict`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error ?? ""}`);
    const ks = key();
    const subBody = { version: Number(sql(`SELECT version FROM app.model_application WHERE id = '${E.id}'`)), note: "Full report attached." };
    const firstSub = await resubmitApi(P.nova, E.id, subBody, ks);
    const againSub = await resubmitApi(P.nova, E.id, subBody, ks);
    check(`${runLabel}.E.resubmit-replay`, firstSub.status === 200 && firstSub.body?.toState === "iame_scrutiny" && againSub.status === 200 && againSub.replay === "true" && sameBody(firstSub.body, againSub.body) && countOf("model_application_resubmission", E.id) === 1, `replay=${againSub.replay}`);
    r = await resubmitApi(P.nova, E.id, { ...subBody, note: "A different note." }, ks);
    check(`${runLabel}.E.resubmit-key-conflict`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error ?? ""}`);

    check(`${runLabel}.seed-untouched`, stateOf(SEEDED_IAME_APP) === "iame_scrutiny" && stateOf(NOVA_FEE_DUE) === "fee_due", "seeded LOCAL-MA-0002 and LOCAL-MA-0003 unchanged");
  } finally {
    cleanupDisposable(createdIds);
    for (const f of blobsNow()) {
      if (!blobsBefore.has(f)) {
        try { fs.unlinkSync(path.join(STORE, f)); } catch { /* ignore */ }
      }
    }
    const after = modelBaseline();
    check(`${runLabel}.baseline-preserved`, before === after, before === after ? "seed rows unchanged" : `drift ${before.slice(0, 30)} vs ${after.slice(0, 30)}`);
    check(`${runLabel}.no-orphan-assignments`, sql(`SELECT count(*) FROM app.assignment WHERE subject_type = 'model_application' AND subject_id NOT IN (SELECT id FROM app.model_application)`) === "0", "no orphan assignments");
    const orphanRows = sql(`SELECT (SELECT count(*) FROM app.model_application_return WHERE application_id NOT IN (SELECT id FROM app.model_application)) + (SELECT count(*) FROM app.model_application_resubmission WHERE application_id NOT IN (SELECT id FROM app.model_application)) + (SELECT count(*) FROM app.model_application_rating WHERE application_id NOT IN (SELECT id FROM app.model_application))`);
    check(`${runLabel}.no-orphan-records`, orphanRows === "0", `orphan return, resubmission and rating rows=${orphanRows}`);
  }
}

async function main() {
  const chrome = await launchChrome();
  try {
    const twins = {};
    for (const [k, u] of [["nova", "nova.applicant"], ["finance", "bee.finance"], ["iame", "iame.officer"], ["reviewer", "bee.reviewer"], ["programme", "bee.programme"], ["director", "bee.director"], ["secretary", "bee.secretary"]]) {
      twins[k] = ids.name(u);
      await totp.ensureEnrolled(twins[k]);
    }
    const pages = {};
    for (const k of Object.keys(twins)) {
      pages[k] = await openPage(chrome.cdp);
      if (!(await signIn(pages[k], twins[k]))) throw new Error(`${k} sign-in failed`);
    }
    // The disposable twin and the real officer tie on load and the lower account id wins, which is the real officer.
    // Pause the real IAME officer's and Reviewer's roles for the run so the next-officer rule picks the twins this check
    // is signed in as; the finally block restores them exactly.
    const REAL = [["iame", REAL_IAME], ["reviewer", REAL_REVIEWER]];
    const was = REAL.map(([role, id]) => sql(`SELECT active FROM app.role_assignment WHERE user_id = '${id}' AND role = '${role}'`));
    for (const [role, id] of REAL) sql(`UPDATE app.role_assignment SET active = false WHERE user_id = '${id}' AND role = '${role}'`);
    try {
      await runReworkChecks("rework.run1", pages);
      await runReworkChecks("rework.run2", pages);
    } finally {
      REAL.forEach(([role, id], i) => sql(`UPDATE app.role_assignment SET active = ${was[i] === "t"} WHERE user_id = '${id}' AND role = '${role}'`));
      check("rework.real-officers-restored", REAL.every(([role, id], i) => sql(`SELECT active FROM app.role_assignment WHERE user_id = '${id}' AND role = '${role}'`) === was[i]), "real IAME officer and Reviewer roles restored");
    }
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("rework.run", false, String(e.message)))
  .then(() => {
    console.log(`return-resubmit checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
