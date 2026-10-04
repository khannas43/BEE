/* eslint-disable */
/** First slice step 3: the assigned IAME officer records a finding and recommends (iame_scrutiny → bee_scrutiny) through the BFF and the portal; baseline-preserving, run twice. */
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

const RUNTIME_IAME = "/api/runtime/model-applications/{id}/iame-recommendation";

const NOVA_COOL = "00000000-0000-4000-d000-000000000001";
const PIXEL_APP = "00000000-0000-4000-c000-000000000003";
const NOVA_FEE_DUE = "00000000-0000-4000-c000-000000000002";
const SEEDED_IAME_APP = "00000000-0000-4000-c000-000000000003";
const REAL_IAME = "00000000-0000-4000-a000-000000000004";
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
const NOTE = "Report matches the declared laboratory and date.";
const recommendBody = (version, extra = {}) => ({ version, verification: "verified", note: NOTE, ...extra });

function recordIame(status, code, r) {
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route: RUNTIME_IAME, method: "POST", status, code: code ?? "-", ok: contract.conforms(doc, RUNTIME_IAME, "POST", faux).length === 0 });
}

/** POST a recommendation and record the contract observation. */
async function recommendApi(page, id, body, idem) {
  const r = await api(page, "POST", iameUrl(id), body, idem);
  recordIame(r.status, r.status >= 400 ? r.body?.error : "-", r);
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

/** A submitted application that Finance has confirmed, so it waits with the IAME officer (iame_scrutiny). */
async function scrutinyApp(nova, finance, createdIds, model) {
  const app = await submittedApp(nova, createdIds, model);
  if (!app.ok) return { ...app, ok: false };
  const r = await api(finance, "POST", feeUrl(app.id), { version: app.version, receiptReference: `UTR-${Date.now().toString(36)}`, receivedOn: RECEIVED_ON, amountInr: "24000.00" }, key());
  return { ...app, ok: r.status === 200 && r.body?.toState === "iame_scrutiny", version: r.body?.version };
}

// jsonb storage reorders object keys, so a replayed body is compared by content, not by serialisation order.
const sameBody = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
const countOf = (table, id) => Number(sql(`SELECT count(*) FROM app.${table} WHERE application_id = '${id}'`));
const stateOf = (id) => sql(`SELECT state FROM app.model_application WHERE id = '${id}'`);

async function runIameChecks(runLabel, nova, finance, iame) {
  const createdIds = [];
  const before = modelBaseline();
  const blobsBefore = blobsNow();
  const tag = `${runLabel}-${Date.now()}`;
  const assignedActive = (id, stage) => Number(sql(`SELECT count(*) FROM app.assignment WHERE subject_id = '${id}' AND stage = '${stage}' AND active`));
  try {
    const A = await scrutinyApp(nova, finance, createdIds, `IR-A-${tag}`);
    check(`${runLabel}.setup.in-scrutiny`, A.ok && stateOf(A.id) === "iame_scrutiny" && assignedActive(A.id, "iame_scrutiny") === 1, `${A.reference} ${A.id ? stateOf(A.id) : "-"}`);

    // What the officer may see: only what is assigned at this stage, with the evidence and the uploaded report.
    let r = await api(iame, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    const items = r.body?.items ?? [];
    check(`${runLabel}.iame.list-scope`, r.status === 200 && items.every((x) => x.state === "iame_scrutiny") && items.some((x) => x.id === A.id) && items.some((x) => x.id === SEEDED_IAME_APP), `${items.length} iame_scrutiny record(s) incl. the seeded one`);
    r = await api(iame, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    check(`${runLabel}.iame.detail-evidence`, r.status === 200 && r.body?.laboratoryCode === "LAB" && r.body?.testedOn === TESTED_OK, `${r.body?.laboratoryCode} ${r.body?.testedOn}`);
    r = await api(iame, "GET", `${WEB}/api/runtime/model-applications/${A.id}/documents`, null, null);
    const versions = (r.body?.items ?? []).flatMap((d) => d.versions ?? []);
    check(`${runLabel}.iame.reads-report`, r.status === 200 && versions.length === 1, `${versions.length} report version(s)`);

    // Refusals leave the application exactly as it was.
    r = await recommendApi(nova, A.id, recommendBody(A.version), key());
    check(`${runLabel}.nova.cannot-recommend`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(finance, A.id, recommendBody(A.version), key());
    check(`${runLabel}.finance.cannot-see-it`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(iame, A.id, recommendBody(A.version, { verification: "maybe" }), key());
    check(`${runLabel}.iame.bad-finding`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(iame, A.id, recommendBody(A.version, { note: "   " }), key());
    check(`${runLabel}.iame.empty-note`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(iame, A.id, recommendBody(A.version, { note: "line one\nline two" }), key());
    check(`${runLabel}.iame.control-characters`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(iame, A.id, recommendBody(A.version, { note: "x".repeat(501) }), key());
    check(`${runLabel}.iame.long-note`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(iame, A.id, recommendBody(A.version), null);
    check(`${runLabel}.iame.missing-key`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(iame, A.id, recommendBody(A.version + 5), key());
    check(`${runLabel}.iame.stale-version`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.refusals-wrote-nothing`, stateOf(A.id) === "iame_scrutiny" && countOf("model_application_iame_recommendation", A.id) === 0 && countOf("model_application_transition_event", A.id) === 1 && assignedActive(A.id, "iame_scrutiny") === 1, "still iame_scrutiny, only Finance's event, officer still assigned");

    // The portal: the applicant reaching the IAME screen is refused by Spring, in the screen's own words.
    await nova.goto(`${WEB}/app/model-label/iame-scrutiny?id=${encodeURIComponent(A.id)}`);
    const novaForm = await nova.waitFor(`!!document.querySelector('[data-testid=iame-recommend-run]')`, 20000);
    if (novaForm) {
      await nova.eval(`document.querySelector('[data-testid=iame-verification-verified]').click(); true`);
      await setInput(nova, "iame-recommend-note", `UI-NOVA-${tag}`.slice(0, 40), "HTMLTextAreaElement");
      await nova.eval(`document.querySelector('[data-testid=iame-recommend-run]').click(); true`);
    }
    const novaErr = novaForm && (await nova.waitFor(`!!document.querySelector('[data-testid=iame-recommend-error]')`, 12000));
    const novaErrText = novaErr ? await nova.eval(`document.querySelector('[data-testid=iame-recommend-error]').textContent`) : "";
    check(`${runLabel}.ui.nova-refused`, !!novaErr && /cannot perform this action/.test(novaErrText) && stateOf(A.id) === "iame_scrutiny", novaErrText.slice(0, 60) || "no error shown");

    // The portal: the assigned officer records the finding.
    await iame.goto(`${WEB}/app/model-label/iame-scrutiny?id=${encodeURIComponent(A.id)}`);
    const ready = await iame.waitFor(`!!document.querySelector('[data-testid=iame-recommend-run]') && !!document.querySelector('[data-testid=iame-detail-fields]')`, 20000);
    const shown = ready ? await iame.eval(`({ fields: document.querySelector('[data-testid=iame-detail-fields]').textContent, inQueue: !!document.querySelector('[data-testid="iame-ref-${A.reference}"]'), hasTable: !!document.querySelector('[data-testid=iame-queue-table]') })`) : null;
    check(`${runLabel}.ui.iame-detail`, !!shown && /LAB/.test(shown.fields) && shown.inQueue && shown.hasTable, shown ? `in queue ${shown.inQueue}` : "form did not load");
    const reportShown = ready && (await iame.waitFor(`!!document.querySelector('[data-testid=model-doc-version-1]')`, 12000));
    check(`${runLabel}.ui.report-listed`, !!reportShown, reportShown ? "the uploaded report is listed with its download link" : "no report shown");
    if (!ready) return;
    await iame.eval(`document.querySelector('[data-testid=iame-recommend-run]').click(); true`);
    const needInput = await iame.waitFor(`!!document.querySelector('[data-testid=iame-recommend-input-error]')`, 8000);
    check(`${runLabel}.ui.needs-finding-and-note`, needInput && stateOf(A.id) === "iame_scrutiny", "nothing sent without a finding and a note");
    const uiNote = `UI finding ${tag}`.slice(0, 80);
    await iame.eval(`document.querySelector('[data-testid=iame-verification-not-verified]').click(); true`);
    await setInput(iame, "iame-recommend-note", uiNote, "HTMLTextAreaElement");
    await iame.eval(`document.querySelector('[data-testid=iame-recommend-run]').click(); true`);
    const done = await iame.waitFor(`!!document.querySelector('[data-testid=iame-recommend-success]')`, 15000);
    const doneText = done ? await iame.eval(`document.querySelector('[data-testid=iame-recommend-success]').textContent`) : "";
    check(`${runLabel}.ui.iame-recommended`, done && doneText.includes(A.reference) && /not verified/.test(doneText) && /bee scrutiny/i.test(doneText), doneText.slice(0, 80) || "no success note");

    // What the recommendation changed, in the database and for each reader.
    check(`${runLabel}.db.state-moved`, stateOf(A.id) === "bee_scrutiny" && sql(`SELECT version FROM app.model_application WHERE id = '${A.id}'`) === String(A.version + 1), `bee_scrutiny v${A.version + 1}`);
    const ev = sql(`SELECT action || ':' || from_state || '>' || to_state || ':' || actor_role FROM app.model_application_transition_event WHERE application_id = '${A.id}' AND action = 'iame_recommend'`);
    check(`${runLabel}.db.event`, ev === "iame_recommend:iame_scrutiny>bee_scrutiny:iame" && countOf("model_application_transition_event", A.id) === 2, ev);
    const rec = sql(`SELECT verification || '|' || note FROM app.model_application_iame_recommendation WHERE application_id = '${A.id}'`);
    check(`${runLabel}.db.recommendation`, rec === `not_verified|${uiNote}`, rec);
    check(`${runLabel}.db.assignments-moved`, assignedActive(A.id, "iame_scrutiny") === 0 && sql(`SELECT count(*) FROM app.assignment a JOIN app.role_assignment r ON r.user_id = a.user_id WHERE a.subject_id = '${A.id}' AND a.stage = 'bee_scrutiny' AND a.active AND r.role = 'reviewer'`) === "1", "officer's assignment closed, one reviewer assigned");
    r = await api(iame, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    const after = await api(iame, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.iame.no-longer-sees-it`, r.status === 404 && r.body?.error === "not_found" && !(after.body?.items ?? []).some((x) => x.id === A.id), "the stage moved on, so the assignment no longer gives access");
    r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    check(`${runLabel}.nova.sees-new-state`, r.status === 200 && r.body?.state === "bee_scrutiny", r.body?.state);
    r = await recommendApi(iame, A.id, recommendBody(A.version + 1), key());
    check(`${runLabel}.iame.cannot-recommend-twice`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.db.still-one-recommendation`, countOf("model_application_iame_recommendation", A.id) === 1, "exactly one recommendation");

    // Idempotency: a lost-response retry replays the receipt; a different body under the same key is refused.
    const B = await scrutinyApp(nova, finance, createdIds, `IR-B-${tag}`);
    const k = key();
    const body = recommendBody(B.version);
    const first = await recommendApi(iame, B.id, body, k);
    const again = await recommendApi(iame, B.id, body, k);
    check(`${runLabel}.iame.replay`, first.status === 200 && again.status === 200 && again.replay === "true" && sameBody(first.body, again.body) && countOf("model_application_iame_recommendation", B.id) === 1, `replay=${again.replay}`);
    r = await recommendApi(iame, B.id, { ...body, note: `OTHER ${tag}`.slice(0, 40) }, k);
    check(`${runLabel}.iame.key-conflict`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error ?? ""}`);

    // The seeded iame_scrutiny application is the officer's to see but was never touched.
    check(`${runLabel}.seed-untouched`, stateOf(SEEDED_IAME_APP) === "iame_scrutiny" && sql(`SELECT count(*) FROM app.assignment WHERE subject_id = '${SEEDED_IAME_APP}' AND stage = 'iame_scrutiny' AND active AND user_id = '${REAL_IAME}'`) === "1", "seeded LOCAL-MA-0003 still iame_scrutiny and assigned to the real officer");
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
    const iameTwin = ids.name("iame.officer");
    await totp.ensureEnrolled(novaTwin);
    await totp.ensureEnrolled(financeTwin);
    await totp.ensureEnrolled(iameTwin);
    const nova = await openPage(chrome.cdp);
    if (!(await signIn(nova, novaTwin))) throw new Error("Nova sign-in failed");
    const finance = await openPage(chrome.cdp);
    if (!(await signIn(finance, financeTwin))) throw new Error("Finance sign-in failed");
    const iame = await openPage(chrome.cdp);
    if (!(await signIn(iame, iameTwin))) throw new Error("IAME sign-in failed");
    // The disposable twin and the real officer tie on load and the lower account id wins, which is the real officer.
    // Pause the real officer's role for the run so the next-officer rule picks the twin this check is signed in as;
    // the finally block restores it exactly.
    const wasActive = sql(`SELECT active FROM app.role_assignment WHERE user_id = '${REAL_IAME}' AND role = 'iame'`);
    sql(`UPDATE app.role_assignment SET active = false WHERE user_id = '${REAL_IAME}' AND role = 'iame'`);
    try {
      await runIameChecks("iame.run1", nova, finance, iame);
      await runIameChecks("iame.run2", nova, finance, iame);
    } finally {
      sql(`UPDATE app.role_assignment SET active = ${wasActive === "t"} WHERE user_id = '${REAL_IAME}' AND role = 'iame'`);
      check("iame.real-officer-restored", sql(`SELECT active FROM app.role_assignment WHERE user_id = '${REAL_IAME}' AND role = 'iame'`) === wasActive, `real officer role active=${wasActive}`);
    }
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("iame.run", false, String(e.message)))
  .then(() => {
    console.log(`iame-recommendation checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
