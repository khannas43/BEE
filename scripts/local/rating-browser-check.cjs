/* eslint-disable */
/** First slice step 5: Programme computes the provisional local rating (rating → director_review) through the BFF and the portal; baseline-preserving, run twice. */
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

const RUNTIME_RATING = "/api/runtime/model-applications/{id}/rating";

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
const rateBody = (version, extra = {}) => ({ version, verifiedIseer: "4.62", ...extra });

function recordRating(status, code, r) {
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route: RUNTIME_RATING, method: "POST", status, code: code ?? "-", ok: contract.conforms(doc, RUNTIME_RATING, "POST", faux).length === 0 });
}

/** POST a rating and record the contract observation. */
async function rateApi(page, id, body, idem) {
  const r = await api(page, "POST", ratingUrl(id), body, idem);
  recordRating(r.status, r.status >= 400 ? r.body?.error : "-", r);
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

/** A submitted application that Finance confirmed, the IAME officer recommended and the Reviewer forwarded, so it waits in rating. */
async function ratingApp(nova, finance, iame, reviewer, createdIds, model) {
  const app = await submittedApp(nova, createdIds, model);
  if (!app.ok) return { ...app, ok: false };
  const f = await api(finance, "POST", `${WEB}/api/runtime/model-applications/${app.id}/fee-confirmation`, { version: app.version, receiptReference: `UTR-${Date.now().toString(36)}`, receivedOn: RECEIVED_ON, amountInr: "24000.00" }, key());
  if (!(f.status === 200 && f.body?.toState === "iame_scrutiny")) return { ...app, ok: false };
  const q = await api(iame, "POST", `${WEB}/api/runtime/model-applications/${app.id}/iame-recommendation`, { version: f.body.version, verification: "verified", note: "Report matches the declared laboratory and date." }, key());
  if (!(q.status === 200 && q.body?.toState === "bee_scrutiny")) return { ...app, ok: false };
  const w = await api(reviewer, "POST", reviewerUrl(app.id), { version: q.body.version, note: "Checked against the application and the IAME note." }, key());
  return { ...app, ok: w.status === 200 && w.body?.toState === "rating", version: w.body?.version };
}

// jsonb storage reorders object keys, so a replayed body is compared by content, not by serialisation order.
const sameBody = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
const countOf = (table, id) => Number(sql(`SELECT count(*) FROM app.${table} WHERE application_id = '${id}'`));
const stateOf = (id) => sql(`SELECT state FROM app.model_application WHERE id = '${id}'`);

async function runRatingChecks(runLabel, nova, finance, iame, reviewer, programme) {
  const createdIds = [];
  const before = modelBaseline();
  const blobsBefore = blobsNow();
  const tag = `${runLabel}-${Date.now()}`;
  const ratingOf = (id) => sql(`SELECT rating_version || '|' || basis || '|' || scheme_key || '|' || declared_iseer || '|' || verified_iseer || '|' || stars FROM app.model_application_rating WHERE application_id = '${id}'`);
  try {
    const A = await ratingApp(nova, finance, iame, reviewer, createdIds, `RT-A-${tag}`);
    check(`${runLabel}.setup.in-rating`, A.ok && stateOf(A.id) === "rating", `${A.reference} ${A.id ? stateOf(A.id) : "-"}`);

    // What Programme may see: only the rating stage, with the evidence and the uploaded report.
    let r = await api(programme, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    const items = r.body?.items ?? [];
    check(`${runLabel}.programme.list-scope`, r.status === 200 && items.length > 0 && items.every((x) => x.state === "rating") && items.some((x) => x.id === A.id), `${items.length} rating-stage record(s)`);
    r = await api(programme, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    check(`${runLabel}.programme.detail-evidence`, r.status === 200 && r.body?.laboratoryCode === "LAB" && r.body?.declaredIseer === 4.5, `${r.body?.laboratoryCode} declared ${r.body?.declaredIseer}`);
    r = await api(programme, "GET", `${WEB}/api/runtime/model-applications/${A.id}/documents`, null, null);
    const versions = (r.body?.items ?? []).flatMap((d) => d.versions ?? []);
    check(`${runLabel}.programme.reads-report`, r.status === 200 && versions.length === 1, `${versions.length} report version(s)`);

    // Refusals leave the application exactly as it was.
    r = await rateApi(nova, A.id, rateBody(A.version), key());
    check(`${runLabel}.nova.cannot-rate`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error ?? ""}`);
    r = await rateApi(reviewer, A.id, rateBody(A.version), key());
    check(`${runLabel}.reviewer.cannot-see-it`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    for (const bad of ["abc", "0", "100.5", "4.555", ""]) {
      r = await rateApi(programme, A.id, rateBody(A.version, { verifiedIseer: bad }), key());
      check(`${runLabel}.programme.bad-figure.${bad || "empty"}`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    }
    r = await rateApi(programme, A.id, rateBody(A.version, { verifiedIseer: "3.29" }), key());
    check(`${runLabel}.programme.below-lowest-band`, r.status === 422 && r.body?.error === "rating_below_threshold", `${r.status} ${r.body?.error ?? ""}`);
    r = await rateApi(programme, A.id, rateBody(A.version), null);
    check(`${runLabel}.programme.missing-key`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error ?? ""}`);
    r = await rateApi(programme, A.id, rateBody(A.version + 5), key());
    check(`${runLabel}.programme.stale-version`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.refusals-wrote-nothing`, stateOf(A.id) === "rating" && countOf("model_application_rating", A.id) === 0 && countOf("model_application_transition_event", A.id) === 3, "still rating, no rating record, only the three earlier events");

    // The portal: the applicant reaching the rating screen is refused by Spring, in the screen's own words.
    await nova.goto(`${WEB}/app/model-label/rating-calculation?id=${encodeURIComponent(A.id)}`);
    const novaForm = await nova.waitFor(`!!document.querySelector('[data-testid=programme-rate-run]')`, 20000);
    if (novaForm) {
      await setInput(nova, "programme-rate-iseer", "4.62");
      await nova.eval(`document.querySelector('[data-testid=programme-rate-run]').click(); true`);
    }
    const novaErr = novaForm && (await nova.waitFor(`!!document.querySelector('[data-testid=programme-rate-error]')`, 12000));
    const novaErrText = novaErr ? await nova.eval(`document.querySelector('[data-testid=programme-rate-error]').textContent`) : "";
    check(`${runLabel}.ui.nova-refused`, !!novaErr && /cannot perform this action/.test(novaErrText) && stateOf(A.id) === "rating", novaErrText.slice(0, 60) || "no error shown");

    // The portal: Programme computes and records the rating.
    await programme.goto(`${WEB}/app/model-label/rating-calculation?id=${encodeURIComponent(A.id)}`);
    const ready = await programme.waitFor(`!!document.querySelector('[data-testid=programme-rate-run]') && !!document.querySelector('[data-testid=programme-detail-fields]')`, 20000);
    const shown = ready ? await programme.eval(`({ fields: document.querySelector('[data-testid=programme-detail-fields]').textContent, inQueue: !!document.querySelector('[data-testid="programme-ref-${A.reference}"]'), hasTable: !!document.querySelector('[data-testid=programme-queue-table]'), label: document.querySelector('[data-testid=programme-detail]').textContent })`) : null;
    check(`${runLabel}.ui.programme-detail`, !!shown && /LAB/.test(shown.fields) && /4\.5/.test(shown.fields) && shown.inQueue && shown.hasTable && /not a BEE rating/.test(shown.label), shown ? `in queue ${shown.inQueue}, labelled provisional` : "form did not load");
    const reportShown = ready && (await programme.waitFor(`!!document.querySelector('[data-testid=model-doc-version-1]')`, 12000));
    check(`${runLabel}.ui.report-listed`, !!reportShown, reportShown ? "the uploaded report is listed with its download link" : "no report shown");
    if (!ready) return;
    await programme.eval(`document.querySelector('[data-testid=programme-rate-run]').click(); true`);
    const needInput = await programme.waitFor(`!!document.querySelector('[data-testid=programme-rate-input-error]')`, 8000);
    check(`${runLabel}.ui.needs-figure`, needInput && stateOf(A.id) === "rating", "nothing sent without a figure");
    await setInput(programme, "programme-rate-iseer", "4.555");
    await programme.eval(`document.querySelector('[data-testid=programme-rate-run]').click(); true`);
    const badFormat = await programme.waitFor(`!!document.querySelector('[data-testid=programme-rate-input-error]')`, 8000);
    check(`${runLabel}.ui.rejects-three-decimals`, badFormat && stateOf(A.id) === "rating", "three decimals are refused before sending");
    await setInput(programme, "programme-rate-iseer", "4.62");
    await programme.eval(`document.querySelector('[data-testid=programme-rate-run]').click(); true`);
    const done = await programme.waitFor(`!!document.querySelector('[data-testid=programme-rate-success]')`, 15000);
    const doneText = done ? await programme.eval(`document.querySelector('[data-testid=programme-rate-success]').textContent`) : "";
    check(`${runLabel}.ui.programme-rated`, done && doneText.includes(A.reference) && /4 stars/.test(doneText) && /Declared 4\.50, verified 4\.62/.test(doneText) && /not a BEE rating/.test(doneText), doneText.slice(0, 110) || "no success note");

    // What the rating changed, in the database and for each reader.
    check(`${runLabel}.db.state-moved`, stateOf(A.id) === "director_review" && sql(`SELECT version FROM app.model_application WHERE id = '${A.id}'`) === String(A.version + 1), `director_review v${A.version + 1}`);
    const ev = sql(`SELECT action || ':' || from_state || '>' || to_state || ':' || actor_role FROM app.model_application_transition_event WHERE application_id = '${A.id}' AND action = 'compute_rating'`);
    check(`${runLabel}.db.event`, ev === "compute_rating:rating>director_review:programme" && countOf("model_application_transition_event", A.id) === 4, ev);
    check(`${runLabel}.db.rating-record`, ratingOf(A.id) === "1|local_demo|RAC-ISEER-DEMO-1|4.50|4.62|4", ratingOf(A.id));
    check(`${runLabel}.db.no-assignment-made`, Number(sql(`SELECT count(*) FROM app.assignment WHERE subject_id = '${A.id}' AND active`)) === 0, "no active assignment: Directors read the next stage by role");
    r = await api(programme, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    const after = await api(programme, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.programme.no-longer-sees-it`, r.status === 404 && r.body?.error === "not_found" && !(after.body?.items ?? []).some((x) => x.id === A.id), "the stage moved on, so Programme's scope no longer includes it");
    r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    check(`${runLabel}.nova.sees-new-state`, r.status === 200 && r.body?.state === "director_review", r.body?.state);
    r = await rateApi(programme, A.id, rateBody(A.version + 1), key());
    check(`${runLabel}.programme.cannot-rate-twice`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.db.still-one-rating`, countOf("model_application_rating", A.id) === 1, "exactly one rating record");

    // The band boundaries: the lowest and the highest figure that earn a rating.
    const C = await ratingApp(nova, finance, iame, reviewer, createdIds, `RT-C-${tag}`);
    r = await rateApi(programme, C.id, rateBody(C.version, { verifiedIseer: "3.30" }), key());
    check(`${runLabel}.programme.lowest-band`, r.status === 200 && r.body?.stars === 1 && r.body?.localDemoRating === true, `${r.status} ${r.body?.stars} star(s)`);

    // Idempotency: a lost-response retry replays the receipt; a different body under the same key is refused.
    const B = await ratingApp(nova, finance, iame, reviewer, createdIds, `RT-B-${tag}`);
    const k = key();
    const body = rateBody(B.version, { verifiedIseer: "5.00" });
    const first = await rateApi(programme, B.id, body, k);
    const again = await rateApi(programme, B.id, body, k);
    check(`${runLabel}.programme.replay`, first.status === 200 && first.body?.stars === 5 && again.status === 200 && again.replay === "true" && sameBody(first.body, again.body) && countOf("model_application_rating", B.id) === 1, `replay=${again.replay}, ${first.body?.stars} stars`);
    r = await rateApi(programme, B.id, { ...body, verifiedIseer: "4.99" }, k);
    check(`${runLabel}.programme.key-conflict`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error ?? ""}`);

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
    const orphanRatings = sql(`SELECT count(*) FROM app.model_application_rating WHERE application_id NOT IN (SELECT id FROM app.model_application)`);
    check(`${runLabel}.no-orphan-ratings`, orphanRatings === "0", `orphan ratings=${orphanRatings}`);
  }
}

async function main() {
  const chrome = await launchChrome();
  try {
    const twins = {};
    for (const [k, u] of [["nova", "nova.applicant"], ["finance", "bee.finance"], ["iame", "iame.officer"], ["reviewer", "bee.reviewer"], ["programme", "bee.programme"]]) {
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
    // is signed in as; the finally block restores them exactly. Programme needs no assignment.
    const REAL = [["iame", REAL_IAME], ["reviewer", REAL_REVIEWER]];
    const was = REAL.map(([role, id]) => sql(`SELECT active FROM app.role_assignment WHERE user_id = '${id}' AND role = '${role}'`));
    for (const [role, id] of REAL) sql(`UPDATE app.role_assignment SET active = false WHERE user_id = '${id}' AND role = '${role}'`);
    try {
      await runRatingChecks("rating.run1", pages.nova, pages.finance, pages.iame, pages.reviewer, pages.programme);
      await runRatingChecks("rating.run2", pages.nova, pages.finance, pages.iame, pages.reviewer, pages.programme);
    } finally {
      REAL.forEach(([role, id], i) => sql(`UPDATE app.role_assignment SET active = ${was[i] === "t"} WHERE user_id = '${id}' AND role = '${role}'`));
      check("rating.real-officers-restored", REAL.every(([role, id], i) => sql(`SELECT active FROM app.role_assignment WHERE user_id = '${id}' AND role = '${role}'`) === was[i]), "real IAME officer and Reviewer roles restored");
    }
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("rating.run", false, String(e.message)))
  .then(() => {
    console.log(`rating checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
