/* eslint-disable */
/** Wave 1: a stage owner rejects an application permanently, with a reason; rejected is terminal through the BFF and the portal; baseline-preserving, run twice. */
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

const RUNTIME_REJECT = "/api/runtime/model-applications/{id}/reject";

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
const REASON = "The test report is for a different model than the one filed.";

function recordReject(r) {
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route: RUNTIME_REJECT, method: "POST", status: r.status, code: r.status >= 400 ? (r.body?.error ?? "-") : "-", ok: contract.conforms(doc, RUNTIME_REJECT, "POST", faux).length === 0 });
}

/** POST a rejection and record the contract observation. */
async function rejectApi(page, id, body, idem) {
  const r = await api(page, "POST", rejectUrl(id), body, idem);
  recordReject(r);
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
const tick = (page, testId) => page.eval(`(() => { const el = document.querySelector('[data-testid=${testId}]'); if (!el.checked) el.click(); return true; })()`);

async function runRejectChecks(runLabel, P) {
  const createdIds = [];
  const before = modelBaseline();
  const blobsBefore = blobsNow();
  const tag = `${runLabel}-${Date.now()}`;
  const rejRow = (id) => sql(`SELECT rejected_from_state || '|' || reason FROM app.model_application_rejection WHERE application_id = '${id}'`);
  const activeAssignments = (id) => Number(sql(`SELECT count(*) FROM app.assignment WHERE subject_id = '${id}' AND active`));
  const version = (id) => Number(sql(`SELECT version FROM app.model_application WHERE id = '${id}'`));
  const actions = (id) => sql(`SELECT string_agg(action, ',' ORDER BY version_after) FROM app.model_application_transition_event WHERE application_id = '${id}'`);

  /** Rejects through the real screen: reason without the tick is refused in the screen, then reason and tick are sent. */
  async function rejectThroughScreen(page, route, id, prefix, successPrefix) {
    const stageState = stateOf(id);
    await page.goto(`${WEB}${route}?id=${encodeURIComponent(id)}`);
    if (!(await present(page, `${prefix}-reject-run`))) return { ok: false, why: "screen did not load" };
    await uiClick(page, `${prefix}-reject-run`);
    const needsBoth = await present(page, `${prefix}-reject-input-error`, 8000);
    await setInput(page, `${prefix}-reject-reason`, REASON, "HTMLTextAreaElement");
    await uiClick(page, `${prefix}-reject-run`);
    await page.waitFor("false", 1500);   // a short pause: with a reason but no tick, nothing may have been sent
    const stillOpen = stateOf(id) === stageState;
    await tick(page, `${prefix}-reject-confirm`);
    await uiClick(page, `${prefix}-reject-run`);
    const done = await present(page, `${successPrefix}-reject-success`, 15000);
    return { ok: done, needsBoth, needsTick: stillOpen, text: done ? await textOf(page, `${successPrefix}-reject-success`) : "" };
  }

  try {
    // ---------------- Scenario A: Programme, which cannot return, rejects through its screen ----------------
    const A = await chainTo("rating", P, createdIds, `RJ-A-${tag}`);
    check(`${runLabel}.A.setup`, A.ok && stateOf(A.id) === "rating", `${A.reference} ${A.id ? stateOf(A.id) : "-"}`);
    let r = await rejectApi(P.nova, A.id, { version: A.version, reason: REASON }, key());
    check(`${runLabel}.A.applicant-cannot-reject`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error ?? ""}`);
    r = await rejectApi(P.reviewer, A.id, { version: A.version, reason: REASON }, key());
    check(`${runLabel}.A.reviewer-cannot-see-the-rating-stage`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    r = await api(P.programme, "POST", returnUrl(A.id), { version: A.version, reason: REASON }, key());
    check(`${runLabel}.A.programme-cannot-return-only-reject`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error ?? ""}`);
    for (const [label, bad] of [["empty", "   "], ["control-characters", "line one\nline two"], ["long", "x".repeat(501)]]) {
      r = await rejectApi(P.programme, A.id, { version: A.version, reason: bad }, key());
      check(`${runLabel}.A.bad-reason.${label}`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    }
    r = await rejectApi(P.programme, A.id, { version: A.version, reason: REASON }, null);
    check(`${runLabel}.A.missing-key`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error ?? ""}`);
    r = await rejectApi(P.programme, A.id, { version: A.version + 5, reason: REASON }, key());
    check(`${runLabel}.A.stale-version`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.A.refusals-wrote-nothing`, stateOf(A.id) === "rating" && countOf("model_application_rejection", A.id) === 0, "still rating, no rejection record");

    const ui = await rejectThroughScreen(P.programme, "/app/model-label/rating-calculation", A.id, "programme", "programme");
    check(`${runLabel}.A.ui.needs-reason-and-tick`, ui.needsBoth && ui.needsTick, "nothing is sent without a reason, and nothing without the confirmation tick");
    check(`${runLabel}.A.ui.programme-rejected`, ui.ok && ui.text.includes(A.reference) && /rejected/i.test(ui.text) && /cannot be changed/.test(ui.text), (ui.text || ui.why || "").slice(0, 100));
    check(`${runLabel}.A.db.rejected`, stateOf(A.id) === "rejected" && rejRow(A.id) === `rating|${REASON}` && actions(A.id).endsWith(",reject") && version(A.id) === A.version + 1, `${stateOf(A.id)}, ${rejRow(A.id).slice(0, 30)}`);
    check(`${runLabel}.A.db.assignments-closed`, activeAssignments(A.id) === 0, "no assignment stays open on a rejected application");
    r = await api(P.programme, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    const progList = await api(P.programme, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.A.programme-no-longer-sees-it`, r.status === 404 && !(progList.body?.items ?? []).some((x) => x.id === A.id), "the stage moved on");

    // The applicant sees why, and it is final.
    r = await api(P.nova, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    check(`${runLabel}.A.nova.sees-why`, r.status === 200 && r.body?.state === "rejected" && r.body?.rejection?.fromState === "rating" && r.body?.rejection?.reason === REASON, `${r.body?.state}, from ${r.body?.rejection?.fromState}`);
    const novaList = await api(P.nova, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.A.list-carries-no-rejection`, (novaList.body?.items ?? []).some((x) => x.id === A.id && x.state === "rejected") && (novaList.body?.items ?? []).every((x) => x.rejection === undefined), "the reason is on the detail read only");
    await P.nova.goto(`${WEB}/app/model-label/model-dashboard?id=${encodeURIComponent(A.id)}`);
    const dashReady = await present(P.nova, "model-app-rejection-reason");
    const dashReason = dashReady ? await textOf(P.nova, "model-app-rejection-reason") : "";
    const hasEdit = dashReady ? await P.nova.eval(`!!document.querySelector('[data-testid=model-app-detail-edit]')`) : true;
    check(`${runLabel}.A.ui.dashboard-shows-reason-and-no-edit`, dashReady && dashReason === REASON && !hasEdit, `${dashReason.slice(0, 40)}…; edit link offered: ${hasEdit}`);
    r = await api(P.nova, "PATCH", `${WEB}/api/runtime/model-applications/${A.id}`, { version: version(A.id), category: "RAC", modelNumber: A.model, declaredIseer: 4.1 }, key());
    check(`${runLabel}.A.cannot-edit`, r.status === 403 && r.body?.error === "not_editable", `${r.status} ${r.body?.error ?? ""}`);
    r = await api(P.nova, "POST", resubmitUrl(A.id), { version: version(A.id) }, key());
    check(`${runLabel}.A.cannot-resubmit`, r.status === 403 && r.body?.error === "not_returned", `${r.status} ${r.body?.error ?? ""}`);
    r = await rejectApi(P.programme, A.id, { version: version(A.id), reason: REASON }, key());
    check(`${runLabel}.A.cannot-reject-twice`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    for (const [who, page] of [["director", P.director], ["secretary", P.secretary], ["iame", P.iame]]) {
      const x = await api(page, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
      if (x.status !== 404) { check(`${runLabel}.A.nobody-else-reads-it`, false, `${who} read it: ${x.status}`); }
    }
    check(`${runLabel}.A.nobody-else-reads-it`, true, "no officer can read a rejected application");

    // The model number is free again: the same applicant files a new application with it, and it is accepted.
    const again = await submittedApp(P.nova, createdIds, A.model);
    check(`${runLabel}.A.model-number-is-freed`, again.ok && stateOf(again.id) === "fee_due", `a new application with the same model number reached ${again.id ? stateOf(again.id) : "-"}`);

    // ---------------- Scenario B: the IAME officer rejects through its screen ----------------
    const B = await chainTo("iame_scrutiny", P, createdIds, `RJ-B-${tag}`);
    const uiB = await rejectThroughScreen(P.iame, "/app/model-label/iame-scrutiny", B.id, "iame", "iame");
    check(`${runLabel}.B.ui.iame-rejected`, uiB.ok && stateOf(B.id) === "rejected" && rejRow(B.id) === `iame_scrutiny|${REASON}` && activeAssignments(B.id) === 0, rejRow(B.id).slice(0, 40));

    // ---------------- Scenario C: the Reviewer, the Director and the Secretary reject through their screens ----------------
    const C = await chainTo("bee_scrutiny", P, createdIds, `RJ-C-${tag}`);
    const uiC = await rejectThroughScreen(P.reviewer, "/app/model-label/bee-scrutiny", C.id, "reviewer", "reviewer");
    check(`${runLabel}.C.ui.reviewer-rejected`, uiC.ok && stateOf(C.id) === "rejected" && rejRow(C.id).startsWith("bee_scrutiny|"), rejRow(C.id).slice(0, 40));
    const D = await chainTo("director_review", P, createdIds, `RJ-D-${tag}`);
    const uiD = await rejectThroughScreen(P.director, "/app/model-label/director-approval", D.id, "director", "director");
    check(`${runLabel}.D.ui.director-rejected`, uiD.ok && stateOf(D.id) === "rejected" && rejRow(D.id).startsWith("director_review|"), rejRow(D.id).slice(0, 40));
    const Sx = await chainTo("secretary_approval", P, createdIds, `RJ-S-${tag}`);
    const uiS = await rejectThroughScreen(P.secretary, "/app/model-label/director-approval", Sx.id, "secretary", "director");
    check(`${runLabel}.D.ui.secretary-rejected`, uiS.ok && stateOf(Sx.id) === "rejected" && rejRow(Sx.id).startsWith("secretary_approval|"), rejRow(Sx.id).slice(0, 40));
    check(`${runLabel}.D.db.history-ends-in-reject`, actions(Sx.id) === "confirm_fee,iame_recommend,reviewer_forward,compute_rating,director_recommend,reject", actions(Sx.id));

    // ---------------- Scenario E: a returned application is with the applicant, so no officer can reject it; idempotency ----------------
    const E = await chainTo("iame_scrutiny", P, createdIds, `RJ-E-${tag}`);
    r = await api(P.iame, "POST", returnUrl(E.id), { version: E.version, reason: "Please attach the full report." }, key());
    const rr = await rejectApi(P.iame, E.id, { version: version(E.id), reason: REASON }, key());
    check(`${runLabel}.E.a-returned-application-cannot-be-rejected`, r.status === 200 && rr.status === 404 && rr.body?.error === "not_found" && stateOf(E.id) === "returned", `returned, then reject: ${rr.status} ${rr.body?.error ?? ""}`);
    const F = await chainTo("iame_scrutiny", P, createdIds, `RJ-F-${tag}`);
    const k = key();
    const body = { version: F.version, reason: REASON };
    const first = await rejectApi(P.iame, F.id, body, k);
    const again2 = await rejectApi(P.iame, F.id, body, k);
    check(`${runLabel}.F.replay`, first.status === 200 && first.body?.toState === "rejected" && again2.status === 200 && again2.replay === "true" && sameBody(first.body, again2.body) && countOf("model_application_rejection", F.id) === 1, `replay=${again2.replay}`);
    r = await rejectApi(P.iame, F.id, { ...body, reason: "A different reason." }, k);
    check(`${runLabel}.F.key-conflict`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error ?? ""}`);

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
    const orphanRows = sql(`SELECT (SELECT count(*) FROM app.model_application_rejection WHERE application_id NOT IN (SELECT id FROM app.model_application)) + (SELECT count(*) FROM app.model_application_return WHERE application_id NOT IN (SELECT id FROM app.model_application)) + (SELECT count(*) FROM app.model_application_rating WHERE application_id NOT IN (SELECT id FROM app.model_application))`);
    check(`${runLabel}.no-orphan-records`, orphanRows === "0", `orphan rejection, return and rating rows=${orphanRows}`);
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
      await runRejectChecks("reject.run1", pages);
      await runRejectChecks("reject.run2", pages);
    } finally {
      REAL.forEach(([role, id], i) => sql(`UPDATE app.role_assignment SET active = ${was[i] === "t"} WHERE user_id = '${id}' AND role = '${role}'`));
      check("reject.real-officers-restored", REAL.every(([role, id], i) => sql(`SELECT active FROM app.role_assignment WHERE user_id = '${id}' AND role = '${role}'`) === was[i]), "real IAME officer and Reviewer roles restored");
    }
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("reject.run", false, String(e.message)))
  .then(() => {
    console.log(`reject checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
