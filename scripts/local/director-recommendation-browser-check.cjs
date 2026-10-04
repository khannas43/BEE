/* eslint-disable */
/** First slice step 6: the Director reviews the rating and recommends approval (director_review → secretary_approval) through the BFF and the portal; baseline-preserving, run twice. */
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

const RUNTIME_DIRECTOR = "/api/runtime/model-applications/{id}/director-recommendation";

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
const directorUrl = (id) => `${WEB}/api/runtime/model-applications/${id}/director-recommendation`;
const NOTE = "Rating reviewed; recommend approval.";
const recommendBody = (version, extra = {}) => ({ version, note: NOTE, ...extra });

function recordDirector(status, code, r) {
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route: RUNTIME_DIRECTOR, method: "POST", status, code: code ?? "-", ok: contract.conforms(doc, RUNTIME_DIRECTOR, "POST", faux).length === 0 });
}

/** POST a recommendation and record the contract observation. */
async function recommendApi(page, id, body, idem) {
  const r = await api(page, "POST", directorUrl(id), body, idem);
  recordDirector(r.status, r.status >= 400 ? r.body?.error : "-", r);
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

/** An application taken through Finance, the IAME officer, the Reviewer and Programme's rating, so it waits for the Director. */
async function directorApp(nova, finance, iame, reviewer, programme, createdIds, model) {
  const app = await submittedApp(nova, createdIds, model);
  if (!app.ok) return { ...app, ok: false };
  const f = await api(finance, "POST", `${WEB}/api/runtime/model-applications/${app.id}/fee-confirmation`, { version: app.version, receiptReference: `UTR-${Date.now().toString(36)}`, receivedOn: RECEIVED_ON, amountInr: "24000.00" }, key());
  if (!(f.status === 200 && f.body?.toState === "iame_scrutiny")) return { ...app, ok: false };
  const q = await api(iame, "POST", `${WEB}/api/runtime/model-applications/${app.id}/iame-recommendation`, { version: f.body.version, verification: "verified", note: "Report matches the declared laboratory and date." }, key());
  if (!(q.status === 200 && q.body?.toState === "bee_scrutiny")) return { ...app, ok: false };
  const w = await api(reviewer, "POST", reviewerUrl(app.id), { version: q.body.version, note: "Checked against the application and the IAME note." }, key());
  if (!(w.status === 200 && w.body?.toState === "rating")) return { ...app, ok: false };
  const g = await api(programme, "POST", ratingUrl(app.id), { version: w.body.version, verifiedIseer: "4.62" }, key());
  return { ...app, ok: g.status === 200 && g.body?.toState === "director_review", version: g.body?.version };
}

// jsonb storage reorders object keys, so a replayed body is compared by content, not by serialisation order.
const sameBody = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
const countOf = (table, id) => Number(sql(`SELECT count(*) FROM app.${table} WHERE application_id = '${id}'`));
const stateOf = (id) => sql(`SELECT state FROM app.model_application WHERE id = '${id}'`);

async function runDirectorChecks(runLabel, nova, finance, iame, reviewer, programme, director) {
  const createdIds = [];
  const before = modelBaseline();
  const blobsBefore = blobsNow();
  const tag = `${runLabel}-${Date.now()}`;
  try {
    const A = await directorApp(nova, finance, iame, reviewer, programme, createdIds, `DR-A-${tag}`);
    check(`${runLabel}.setup.in-director-review`, A.ok && stateOf(A.id) === "director_review", `${A.reference} ${A.id ? stateOf(A.id) : "-"}`);

    // What the Director may see: only the director_review stage, with the rating, the evidence and the report.
    let r = await api(director, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    const items = r.body?.items ?? [];
    check(`${runLabel}.director.list-scope`, r.status === 200 && items.length > 0 && items.every((x) => x.state === "director_review") && items.some((x) => x.id === A.id), `${items.length} director_review record(s)`);
    r = await api(director, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    const rt = r.body?.rating;
    check(`${runLabel}.director.sees-rating`, r.status === 200 && rt?.stars === 4 && rt?.declaredIseer === "4.50" && rt?.verifiedIseer === "4.62" && rt?.localDemoRating === true && rt?.schemeKey === "RAC-ISEER-DEMO-1", `${rt?.stars} stars, declared ${rt?.declaredIseer}, verified ${rt?.verifiedIseer}, local demo ${rt?.localDemoRating}`);
    r = await api(director, "GET", `${WEB}/api/runtime/model-applications/${A.id}/documents`, null, null);
    const versions = (r.body?.items ?? []).flatMap((d) => d.versions ?? []);
    check(`${runLabel}.director.reads-report`, r.status === 200 && versions.length === 1, `${versions.length} report version(s)`);
    r = await api(director, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.list-carries-no-rating`, (r.body?.items ?? []).every((x) => x.rating === undefined), "the rating is on the detail read only");

    // Refusals leave the application exactly as it was.
    r = await recommendApi(nova, A.id, recommendBody(A.version), key());
    check(`${runLabel}.nova.cannot-recommend`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(programme, A.id, recommendBody(A.version), key());
    check(`${runLabel}.programme.cannot-see-it`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(director, A.id, recommendBody(A.version, { note: "   " }), key());
    check(`${runLabel}.director.empty-note`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(director, A.id, recommendBody(A.version, { note: "line one\nline two" }), key());
    check(`${runLabel}.director.control-characters`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(director, A.id, recommendBody(A.version, { note: "x".repeat(501) }), key());
    check(`${runLabel}.director.long-note`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(director, A.id, recommendBody(A.version), null);
    check(`${runLabel}.director.missing-key`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error ?? ""}`);
    r = await recommendApi(director, A.id, recommendBody(A.version + 5), key());
    check(`${runLabel}.director.stale-version`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.refusals-wrote-nothing`, stateOf(A.id) === "director_review" && countOf("model_application_director_recommendation", A.id) === 0 && countOf("model_application_transition_event", A.id) === 4, "still director_review, no recommendation, only the four earlier events");

    // The portal: the applicant reaching the Director screen is refused by Spring, in the screen's own words.
    await nova.goto(`${WEB}/app/model-label/director-approval?id=${encodeURIComponent(A.id)}`);
    const novaForm = await nova.waitFor(`!!document.querySelector('[data-testid=director-recommend-run]')`, 20000);
    if (novaForm) {
      await setInput(nova, "director-recommend-note", `UI-NOVA-${tag}`.slice(0, 40), "HTMLTextAreaElement");
      await nova.eval(`document.querySelector('[data-testid=director-recommend-run]').click(); true`);
    }
    const novaErr = novaForm && (await nova.waitFor(`!!document.querySelector('[data-testid=director-recommend-error]')`, 12000));
    const novaErrText = novaErr ? await nova.eval(`document.querySelector('[data-testid=director-recommend-error]').textContent`) : "";
    check(`${runLabel}.ui.nova-refused`, !!novaErr && /cannot perform this action/.test(novaErrText) && stateOf(A.id) === "director_review", novaErrText.slice(0, 60) || "no error shown");

    // The portal: the Director reviews the rating and recommends.
    await director.goto(`${WEB}/app/model-label/director-approval?id=${encodeURIComponent(A.id)}`);
    const ready = await director.waitFor(`!!document.querySelector('[data-testid=director-recommend-run]') && !!document.querySelector('[data-testid=approval-rating-stars]')`, 20000);
    const shown = ready ? await director.eval(`({ stars: document.querySelector('[data-testid=approval-rating-stars]').textContent, rating: document.querySelector('[data-testid=approval-rating]').textContent, inQueue: !!document.querySelector('[data-testid="approval-ref-${A.reference}"]'), hasTable: !!document.querySelector('[data-testid=approval-queue-table]') })`) : null;
    check(`${runLabel}.ui.director-sees-rating`, !!shown && /4 stars/.test(shown.stars) && /Declared 4\.50, verified 4\.62/.test(shown.rating) && /not a BEE rating/.test(shown.rating) && shown.inQueue && shown.hasTable, shown ? `${shown.stars.trim()}, labelled provisional` : "form did not load");
    const reportShown = ready && (await director.waitFor(`!!document.querySelector('[data-testid=model-doc-version-1]')`, 12000));
    check(`${runLabel}.ui.report-listed`, !!reportShown, reportShown ? "the uploaded report is listed with its download link" : "no report shown");
    if (!ready) return;
    await director.eval(`document.querySelector('[data-testid=director-recommend-run]').click(); true`);
    const needInput = await director.waitFor(`!!document.querySelector('[data-testid=director-recommend-input-error]')`, 8000);
    check(`${runLabel}.ui.needs-note`, needInput && stateOf(A.id) === "director_review", "nothing sent without a note");
    const uiNote = `UI recommend ${tag}`.slice(0, 80);
    await setInput(director, "director-recommend-note", uiNote, "HTMLTextAreaElement");
    await director.eval(`document.querySelector('[data-testid=director-recommend-run]').click(); true`);
    const done = await director.waitFor(`!!document.querySelector('[data-testid=director-recommend-success]')`, 15000);
    const doneText = done ? await director.eval(`document.querySelector('[data-testid=director-recommend-success]').textContent`) : "";
    check(`${runLabel}.ui.director-recommended`, done && doneText.includes(A.reference) && /secretary approval/i.test(doneText) && /Sent to the Secretary/.test(doneText), doneText.slice(0, 110) || "no success note");

    // What the recommendation changed, in the database and for each reader. RAC is not final by default, so it goes to the Secretary.
    check(`${runLabel}.db.state-moved`, stateOf(A.id) === "secretary_approval" && sql(`SELECT version FROM app.model_application WHERE id = '${A.id}'`) === String(A.version + 1), `secretary_approval v${A.version + 1}`);
    const ev = sql(`SELECT action || ':' || from_state || '>' || to_state || ':' || actor_role FROM app.model_application_transition_event WHERE application_id = '${A.id}' AND action = 'director_recommend'`);
    check(`${runLabel}.db.event`, ev === "director_recommend:director_review>secretary_approval:director" && countOf("model_application_transition_event", A.id) === 5, ev);
    const rec = sql(`SELECT note || '|' || director_final || '|' || resulting_state FROM app.model_application_director_recommendation WHERE application_id = '${A.id}'`);
    check(`${runLabel}.db.recommendation-record`, rec === `${uiNote}|false|secretary_approval`, rec);
    check(`${runLabel}.db.no-assignment-made`, Number(sql(`SELECT count(*) FROM app.assignment WHERE subject_id = '${A.id}' AND active`)) === 0, "no active assignment: the Secretary reads the next stage by role");
    r = await api(director, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    const after = await api(director, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.director.no-longer-sees-it`, r.status === 404 && r.body?.error === "not_found" && !(after.body?.items ?? []).some((x) => x.id === A.id), "the stage moved on, so the Director's scope no longer includes it");
    r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    check(`${runLabel}.nova.sees-new-state-and-rating`, r.status === 200 && r.body?.state === "secretary_approval" && r.body?.rating?.stars === 4, `${r.body?.state}, ${r.body?.rating?.stars} stars`);
    r = await recommendApi(director, A.id, recommendBody(A.version + 1), key());
    check(`${runLabel}.director.cannot-recommend-twice`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.db.still-one-recommendation`, countOf("model_application_director_recommendation", A.id) === 1, "exactly one recommendation");

    // Idempotency: a lost-response retry replays the receipt; a different body under the same key is refused.
    const B = await directorApp(nova, finance, iame, reviewer, programme, createdIds, `DR-B-${tag}`);
    const k = key();
    const body = recommendBody(B.version);
    const first = await recommendApi(director, B.id, body, k);
    const again = await recommendApi(director, B.id, body, k);
    check(`${runLabel}.director.replay`, first.status === 200 && first.body?.directorFinal === false && first.body?.toState === "secretary_approval" && again.status === 200 && again.replay === "true" && sameBody(first.body, again.body) && countOf("model_application_director_recommendation", B.id) === 1, `replay=${again.replay}`);
    r = await recommendApi(director, B.id, { ...body, note: `OTHER ${tag}`.slice(0, 40) }, k);
    check(`${runLabel}.director.key-conflict`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error ?? ""}`);

    // The seeded applications are untouched.
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
    const orphans = sql(`SELECT count(*) FROM app.assignment WHERE subject_type = 'model_application' AND subject_id NOT IN (SELECT id FROM app.model_application)`);
    check(`${runLabel}.no-orphan-assignments`, orphans === "0", `orphan assignments=${orphans}`);
    const orphanRows = sql(`SELECT (SELECT count(*) FROM app.model_application_rating WHERE application_id NOT IN (SELECT id FROM app.model_application)) + (SELECT count(*) FROM app.model_application_director_recommendation WHERE application_id NOT IN (SELECT id FROM app.model_application))`);
    check(`${runLabel}.no-orphan-records`, orphanRows === "0", `orphan rating and recommendation rows=${orphanRows}`);
  }
}

async function main() {
  const chrome = await launchChrome();
  try {
    const twins = {};
    for (const [k, u] of [["nova", "nova.applicant"], ["finance", "bee.finance"], ["iame", "iame.officer"], ["reviewer", "bee.reviewer"], ["programme", "bee.programme"], ["director", "bee.director"]]) {
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
    // is signed in as; the finally block restores them exactly. Programme and the Director need no assignment.
    const REAL = [["iame", REAL_IAME], ["reviewer", REAL_REVIEWER]];
    const was = REAL.map(([role, id]) => sql(`SELECT active FROM app.role_assignment WHERE user_id = '${id}' AND role = '${role}'`));
    for (const [role, id] of REAL) sql(`UPDATE app.role_assignment SET active = false WHERE user_id = '${id}' AND role = '${role}'`);
    try {
      await runDirectorChecks("director.run1", pages.nova, pages.finance, pages.iame, pages.reviewer, pages.programme, pages.director);
      await runDirectorChecks("director.run2", pages.nova, pages.finance, pages.iame, pages.reviewer, pages.programme, pages.director);
    } finally {
      REAL.forEach(([role, id], i) => sql(`UPDATE app.role_assignment SET active = ${was[i] === "t"} WHERE user_id = '${id}' AND role = '${role}'`));
      check("director.real-officers-restored", REAL.every(([role, id], i) => sql(`SELECT active FROM app.role_assignment WHERE user_id = '${id}' AND role = '${role}'`) === was[i]), "real IAME officer and Reviewer roles restored");
    }
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("director.run", false, String(e.message)))
  .then(() => {
    console.log(`director-recommendation checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
