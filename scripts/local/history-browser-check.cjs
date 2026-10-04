/* eslint-disable */
/** Wave 1: the history of an application: every step in order, who took it, and the notes, with the officers' internal notes withheld from the applicant through the BFF and the portal; baseline-preserving, run twice. */
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

const RUNTIME_HISTORY = "/api/runtime/model-applications/{id}/history";

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
  if (stage === "rating") { version = w.body.version; return done(); }
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
const actionsOf = (h) => (h.body?.items ?? []).map((x) => x.action).join(",");

async function runHistoryChecks(runLabel, P) {
  const createdIds = [];
  const before = modelBaseline();
  const blobsBefore = blobsNow();
  const tag = `${runLabel}-${Date.now()}`;
  // Unique texts, so a check can tell exactly whose note it is looking at.
  const N = { iame: `IAME-NOTE-${tag}`, reviewer: `REVIEWER-NOTE-${tag}`, director: `DIRECTOR-NOTE-${tag}`, secretary: `SECRETARY-NOTE-${tag}`, back: `RETURN-REASON-${tag}`, resub: `RESUBMIT-NOTE-${tag}` };
  const version = (id) => Number(sql(`SELECT version FROM app.model_application WHERE id = '${id}'`));
  try {
    // ---- One application walked through every step by seven different people, reading the history at each stage ----
    const app = await submittedApp(P.nova, createdIds, `HS-${tag}`);
    check(`${runLabel}.setup`, app.ok, `${app.reference} ${app.id ? stateOf(app.id) : "-"}`);
    const id = app.id;
    let r = await historyApi(P.nova, id);
    check(`${runLabel}.applicant.first-view`, r.status === 200 && r.body?.viewedAs === "applicant" && actionsOf(r) === "submit" && r.body?.count === 1, `${r.body?.viewedAs}: ${actionsOf(r)}`);
    r = await historyApi(P.finance, id);
    check(`${runLabel}.finance.reads-fee-due`, r.status === 200 && r.body?.viewedAs === "officer" && /^Nova Applicant/.test(r.body?.items?.[0]?.actorName ?? ""), `${r.status} ${r.body?.viewedAs}`);

    const f = await api(P.finance, "POST", feeUrl(id), { version: app.version, receiptReference: `UTR-${tag}`.slice(0, 40), receivedOn: RECEIVED_ON, amountInr: "24000.00" }, key());
    r = await historyApi(P.iame, id);
    const fee = r.body?.items?.[1];
    check(`${runLabel}.iame.sees-the-fee-confirmation`, r.status === 200 && fee?.action === "confirm_fee" && fee.facts.some((x) => x.label === "Receipt reference" && x.value.startsWith("UTR-")) && fee.facts.some((x) => x.value === "₹24000.00") && fee.actorRole === "finance" && /^BEE Finance/.test(fee.actorName ?? ""), `${fee?.actorName}: ${fee?.facts?.map((x) => x.value).join(" / ")}`);

    const q = await api(P.iame, "POST", iameUrl(id), { version: f.body.version, verification: "not_verified", note: N.iame }, key());
    r = await historyApi(P.reviewer, id);
    const iameStep = r.body?.items?.[2];
    check(`${runLabel}.reviewer.sees-the-iame-finding-and-note`, r.status === 200 && iameStep?.action === "iame_recommend" && iameStep.note === N.iame && iameStep.facts.some((x) => x.value === "Not verified") && /^IAME Officer/.test(iameStep.actorName ?? ""), `${iameStep?.facts?.map((x) => x.value).join(",")}; note ${iameStep?.note === N.iame ? "seen" : "MISSING"}`);

    const w = await api(P.reviewer, "POST", reviewerUrl(id), { version: q.body.version, note: N.reviewer }, key());
    r = await historyApi(P.programme, id);
    check(`${runLabel}.programme.sees-both-earlier-notes`, r.status === 200 && r.body?.items?.[2]?.note === N.iame && r.body?.items?.[3]?.note === N.reviewer && actionsOf(r) === "submit,confirm_fee,iame_recommend,reviewer_forward", actionsOf(r));

    const g = await api(P.programme, "POST", ratingUrl(id), { version: w.body.version, verifiedIseer: "4.62" }, key());
    r = await historyApi(P.director, id);
    const ratingStep = r.body?.items?.[4];
    check(`${runLabel}.director.sees-the-rating-figures-and-every-note`, r.status === 200 && ratingStep?.action === "compute_rating" && ratingStep.facts.some((x) => /4 \(local demonstration, not a BEE rating\)/.test(x.value)) && ratingStep.facts.some((x) => x.label === "Declared efficiency" && x.value === "4.50") && ratingStep.facts.some((x) => x.label === "Verified efficiency" && x.value === "4.62") && r.body?.items?.[2]?.note === N.iame && r.body?.items?.[3]?.note === N.reviewer, `${ratingStep?.facts?.map((x) => x.label + "=" + x.value).join("; ")}`);

    const d = await api(P.director, "POST", directorUrl(id), { version: g.body.version, note: N.director }, key());
    r = await historyApi(P.secretary, id);
    const dirStep = r.body?.items?.[5];
    check(`${runLabel}.secretary.sees-the-directors-note-and-whether-it-was-final`, r.status === 200 && dirStep?.action === "director_recommend" && dirStep.note === N.director && dirStep.facts.some((x) => x.label === "Final for this category" && x.value === "No"), `note ${dirStep?.note === N.director ? "seen" : "MISSING"}`);

    // The Secretary sends it back; the applicant answers; the Secretary approves.
    const back = await api(P.secretary, "POST", returnUrl(id), { version: d.body.version, reason: N.back }, key());
    const sub = await api(P.nova, "POST", resubmitUrl(id), { version: version(id), note: N.resub }, key());
    const fin = await api(P.secretary, "POST", secretaryUrl(id), { version: version(id), note: N.secretary }, key());
    check(`${runLabel}.journey-completed`, back.status === 200 && sub.status === 200 && fin.status === 200 && stateOf(id) === "approved", `return ${back.status}, resubmit ${sub.status}, approve ${fin.status} -> ${stateOf(id)}`);

    // ---- What the applicant sees of all of it ----
    const A = await historyApi(P.nova, id);
    const raw = JSON.stringify(A.body);
    check(`${runLabel}.applicant.sees-the-whole-timeline-in-order`, A.status === 200 && A.body?.viewedAs === "applicant" && actionsOf(A) === "submit,confirm_fee,iame_recommend,reviewer_forward,compute_rating,director_recommend,return,resubmit,secretary_approve" && A.body.items.every((x, i) => x.sequence === i + 1), actionsOf(A));
    check(`${runLabel}.applicant.sees-no-personal-names`, !raw.includes("actorName") && !raw.includes("BEE Finance") && !raw.includes("IAME Officer") && !raw.includes("BEE Director") && !raw.includes("BEE Secretary"), "only the role and the organisation of each step");
    check(`${runLabel}.applicant.internal-notes-withheld`, [N.iame, N.reviewer, N.director, N.secretary].every((n) => !raw.includes(n)) && !raw.includes("Not verified") && !raw.includes("Verified efficiency") && !raw.includes("RAC-ISEER"), "no officer's note, finding or rating figure");
    check(`${runLabel}.applicant.five-internal-steps-marked-withheld`, A.body.items.filter((x) => x.withheld).map((x) => x.action).join(",") === "iame_recommend,reviewer_forward,compute_rating,director_recommend,secretary_approve", A.body.items.filter((x) => x.withheld).length + " steps say so");
    const mine = Object.fromEntries(A.body.items.map((x) => [x.action, x]));
    check(`${runLabel}.applicant.sees-what-was-addressed-to-them`, mine.return.note === N.back && mine.resubmit.note === N.resub && mine.confirm_fee.facts.some((x) => x.label === "Receipt reference"), "their payment, the reason they were given and their own resubmission");
    r = await historyApi(P.finance, id);
    check(`${runLabel}.finished-application-is-closed-to-officers`, r.status === 404, `an approved application is read by nobody but the applicant (${r.status})`);
    r = await api(P.nova, "GET", `${WEB}/api/runtime/model-applications/${id}`, null, null);
    check(`${runLabel}.the-detail-read-is-unchanged`, r.status === 200 && r.body?.state === "approved" && r.body?.rating?.stars === 4 && r.body?.history === undefined, "the history is its own read, not part of the application");

    // ---- On the real screens ----
    await P.nova.goto(`${WEB}/app/model-label/model-dashboard?id=${encodeURIComponent(id)}&tab=history`);
    const listed = await present(P.nova, "model-app-history-list");
    const ui = listed ? await P.nova.eval(`({ steps: document.querySelectorAll('[data-testid^="model-app-history-step-"]').length, withheld: document.querySelectorAll('[data-testid^="model-app-history-withheld-"]').length, applicant: document.querySelector('[data-testid=model-app-history]').dataset.viewedAs, text: document.querySelector('[data-testid=model-app-history-list]').textContent })`) : null;
    check(`${runLabel}.ui.applicant-history-tab`, !!ui && ui.steps === 9 && ui.withheld === 5 && ui.applicant === "applicant" && ui.text.includes(N.back) && !ui.text.includes(N.iame) && /Internal note, not shown to you/.test(ui.text), ui ? `${ui.steps} steps, ${ui.withheld} withheld` : "tab did not load");
    await P.nova.goto(`${WEB}/app/model-label/model-dashboard?id=${encodeURIComponent(id)}`);
    check(`${runLabel}.ui.history-is-a-tab-beside-details-and-documents`, await present(P.nova, "model-app-detail-tab-history") && await present(P.nova, "model-app-detail-tab-documents") && await present(P.nova, "model-app-detail-tab-details"), "three tabs");

    // The officer screens: an application at each officer's stage, with the earlier notes on the screen itself.
    const X = await chainTo("director_review", P, createdIds, `HS-X-${tag}`);
    await P.director.goto(`${WEB}/app/model-label/director-approval?id=${encodeURIComponent(X.id)}`);
    const dirReady = await present(P.director, "director-history-list");
    const dirText = dirReady ? await textOf(P.director, "director-history-list") : "";
    check(`${runLabel}.ui.director-screen-shows-the-earlier-steps`, dirReady && /Fee confirmed/.test(dirText) && /IAME scrutiny recommended/.test(dirText) && /Rating computed/.test(dirText) && /Verified efficiency/.test(dirText) && /IAME Officer/.test(dirText), dirText.slice(0, 80).replace(/\s+/g, " "));
    const Y = await chainTo("bee_scrutiny", P, createdIds, `HS-Y-${tag}`);
    await P.reviewer.goto(`${WEB}/app/model-label/bee-scrutiny?id=${encodeURIComponent(Y.id)}`);
    const revReady = await present(P.reviewer, "reviewer-history-note-3");
    const revNote = revReady ? await textOf(P.reviewer, "reviewer-history-note-3") : "";
    check(`${runLabel}.ui.reviewer-screen-shows-the-iame-note`, revReady && revNote === "Report matches the declared laboratory and date.", revNote.slice(0, 60) || "no note on the screen");

    // ---- A rejected application, and what is not a history ----
    const Z = await chainTo("iame_scrutiny", P, createdIds, `HS-Z-${tag}`);
    const rj = await api(P.iame, "POST", rejectUrl(Z.id), { version: Z.version, reason: "Wrong model." }, key());
    r = await historyApi(P.nova, Z.id);
    const last = r.body?.items?.[r.body.items.length - 1];
    check(`${runLabel}.rejected.history-ends-in-the-reason`, rj.status === 200 && last?.action === "reject" && last.toState === "rejected" && last.note === "Wrong model.", `${last?.action}: ${last?.note}`);
    r = await historyApi(P.nova, "00000000-0000-4000-c000-00000000dead");
    check(`${runLabel}.unknown-application-is-not-found`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    r = await historyApi(P.nova, "not-a-uuid");
    check(`${runLabel}.malformed-id-is-not-found`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    const W = await chainTo("rating", P, createdIds, `HS-W-${tag}`);
    r = await historyApi(P.reviewer, W.id);
    check(`${runLabel}.an-officer-cannot-read-another-stage`, r.status === 404, `the Reviewer on a rating-stage application: ${r.status}`);
    r = await api(P.nova, "POST", historyUrl(id), {}, key());
    check(`${runLabel}.history-is-read-only`, r.status === 405 && r.body?.error === "method_not_allowed", `${r.status} ${r.body?.error ?? ""}`);
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
      await runHistoryChecks("history.run1", pages);
      await runHistoryChecks("history.run2", pages);
    } finally {
      REAL.forEach(([role, id], i) => sql(`UPDATE app.role_assignment SET active = ${was[i] === "t"} WHERE user_id = '${id}' AND role = '${role}'`));
      check("history.real-officers-restored", REAL.every(([role, id], i) => sql(`SELECT active FROM app.role_assignment WHERE user_id = '${id}' AND role = '${role}'`) === was[i]), "real IAME officer and Reviewer roles restored");
    }
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("history.run", false, String(e.message)))
  .then(() => {
    console.log(`history checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
