/* eslint-disable */
/** First slice step 7: the Secretary gives final approval (secretary_approval → approved), the end of the first slice through the BFF and the portal; baseline-preserving, run twice. */
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

const RUNTIME_SECRETARY = "/api/runtime/model-applications/{id}/secretary-approval";

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
const NOTE = "Rating reviewed; approved.";
const approveBody = (version, extra = {}) => ({ version, note: NOTE, ...extra });

function recordSecretary(status, code, r) {
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route: RUNTIME_SECRETARY, method: "POST", status, code: code ?? "-", ok: contract.conforms(doc, RUNTIME_SECRETARY, "POST", faux).length === 0 });
}

/** POST an approval and record the contract observation. */
async function approveApi(page, id, body, idem) {
  const r = await api(page, "POST", secretaryUrl(id), body, idem);
  recordSecretary(r.status, r.status >= 400 ? r.body?.error : "-", r);
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

/** An application taken through Finance, the IAME officer, the Reviewer and Programme's rating, the Director's recommendation (not final for RAC), so it waits for the Secretary. */
async function secretaryApp(nova, finance, iame, reviewer, programme, director, createdIds, model) {
  const app = await submittedApp(nova, createdIds, model);
  if (!app.ok) return { ...app, ok: false };
  const f = await api(finance, "POST", `${WEB}/api/runtime/model-applications/${app.id}/fee-confirmation`, { version: app.version, receiptReference: `UTR-${Date.now().toString(36)}`, receivedOn: RECEIVED_ON, amountInr: "24000.00" }, key());
  if (!(f.status === 200 && f.body?.toState === "iame_scrutiny")) return { ...app, ok: false };
  const q = await api(iame, "POST", `${WEB}/api/runtime/model-applications/${app.id}/iame-recommendation`, { version: f.body.version, verification: "verified", note: "Report matches the declared laboratory and date." }, key());
  if (!(q.status === 200 && q.body?.toState === "bee_scrutiny")) return { ...app, ok: false };
  const w = await api(reviewer, "POST", reviewerUrl(app.id), { version: q.body.version, note: "Checked against the application and the IAME note." }, key());
  if (!(w.status === 200 && w.body?.toState === "rating")) return { ...app, ok: false };
  const g = await api(programme, "POST", ratingUrl(app.id), { version: w.body.version, verifiedIseer: "4.62" }, key());
  if (!(g.status === 200 && g.body?.toState === "director_review")) return { ...app, ok: false };
  const d = await api(director, "POST", directorUrl(app.id), { version: g.body.version, note: "Rating reviewed; recommend approval." }, key());
  return { ...app, ok: d.status === 200 && d.body?.toState === "secretary_approval" && d.body?.directorFinal === false, version: d.body?.version };
}

// jsonb storage reorders object keys, so a replayed body is compared by content, not by serialisation order.
const sameBody = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());
const countOf = (table, id) => Number(sql(`SELECT count(*) FROM app.${table} WHERE application_id = '${id}'`));
const stateOf = (id) => sql(`SELECT state FROM app.model_application WHERE id = '${id}'`);

async function runSecretaryChecks(runLabel, nova, finance, iame, reviewer, programme, director, secretary, anon) {
  const createdIds = [];
  const before = modelBaseline();
  const blobsBefore = blobsNow();
  const tag = `${runLabel}-${Date.now()}`;
  try {
    const A = await secretaryApp(nova, finance, iame, reviewer, programme, director, createdIds, `SA-A-${tag}`);
    check(`${runLabel}.setup.in-secretary-approval`, A.ok && stateOf(A.id) === "secretary_approval", `${A.reference} ${A.id ? stateOf(A.id) : "-"}`);

    // What the Secretary may see: only the secretary_approval stage, with the rating, the evidence and the report.
    let r = await api(secretary, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    const items = r.body?.items ?? [];
    check(`${runLabel}.secretary.list-scope`, r.status === 200 && items.length > 0 && items.every((x) => x.state === "secretary_approval") && items.some((x) => x.id === A.id), `${items.length} secretary_approval record(s)`);
    r = await api(secretary, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    const rt = r.body?.rating;
    check(`${runLabel}.secretary.sees-rating`, r.status === 200 && rt?.stars === 4 && rt?.localDemoRating === true, `${rt?.stars} stars, local demo ${rt?.localDemoRating}`);
    r = await api(secretary, "GET", `${WEB}/api/runtime/model-applications/${A.id}/documents`, null, null);
    const versions = (r.body?.items ?? []).flatMap((d) => d.versions ?? []);
    check(`${runLabel}.secretary.reads-report`, r.status === 200 && versions.length === 1, `${versions.length} report version(s)`);

    // Refusals leave the application exactly as it was.
    r = await approveApi(nova, A.id, approveBody(A.version), key());
    check(`${runLabel}.nova.cannot-approve`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error ?? ""}`);
    r = await approveApi(director, A.id, approveBody(A.version), key());
    check(`${runLabel}.director.cannot-approve-its-own-recommendation`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""} (the Director reads only director_review)`);
    r = await approveApi(secretary, A.id, approveBody(A.version, { note: "   " }), key());
    check(`${runLabel}.secretary.empty-note`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await approveApi(secretary, A.id, approveBody(A.version, { note: "line one\nline two" }), key());
    check(`${runLabel}.secretary.control-characters`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await approveApi(secretary, A.id, approveBody(A.version, { note: "x".repeat(501) }), key());
    check(`${runLabel}.secretary.long-note`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error ?? ""}`);
    r = await approveApi(secretary, A.id, approveBody(A.version), null);
    check(`${runLabel}.secretary.missing-key`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error ?? ""}`);
    r = await approveApi(secretary, A.id, approveBody(A.version + 5), key());
    check(`${runLabel}.secretary.stale-version`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.refusals-wrote-nothing`, stateOf(A.id) === "secretary_approval" && countOf("model_application_secretary_approval", A.id) === 0 && countOf("model_application_transition_event", A.id) === 5, "still secretary_approval, no approval, only the five earlier events");

    // The portal: the applicant reaching the screen is refused by Spring, in the screen's own words.
    await nova.goto(`${WEB}/app/model-label/director-approval?id=${encodeURIComponent(A.id)}`);
    const novaForm = await nova.waitFor(`!!document.querySelector('[data-testid=secretary-approve-run]')`, 20000);
    if (novaForm) {
      await setInput(nova, "secretary-approve-note", `UI-NOVA-${tag}`.slice(0, 40), "HTMLTextAreaElement");
      await nova.eval(`document.querySelector('[data-testid=secretary-approve-run]').click(); true`);
    }
    const novaErr = novaForm && (await nova.waitFor(`!!document.querySelector('[data-testid=secretary-approve-error]')`, 12000));
    const novaErrText = novaErr ? await nova.eval(`document.querySelector('[data-testid=secretary-approve-error]').textContent`) : "";
    check(`${runLabel}.ui.nova-refused`, !!novaErr && /cannot perform this action/.test(novaErrText) && stateOf(A.id) === "secretary_approval", novaErrText.slice(0, 60) || "no error shown");

    // The portal: the Secretary reviews the rating and approves.
    await secretary.goto(`${WEB}/app/model-label/director-approval?id=${encodeURIComponent(A.id)}`);
    const ready = await secretary.waitFor(`!!document.querySelector('[data-testid=secretary-approve-run]') && !!document.querySelector('[data-testid=approval-rating-stars]')`, 20000);
    const shown = ready ? await secretary.eval(`({ stars: document.querySelector('[data-testid=approval-rating-stars]').textContent, rating: document.querySelector('[data-testid=approval-rating]').textContent, fields: document.querySelector('[data-testid=approval-detail-fields]').textContent, inQueue: !!document.querySelector('[data-testid="approval-ref-${A.reference}"]'), directorForm: !!document.querySelector('[data-testid=director-recommend-run]') })`) : null;
    check(`${runLabel}.ui.secretary-sees-rating`, !!shown && /4 stars/.test(shown.stars) && /not a BEE rating/.test(shown.rating) && /secretary approval/i.test(shown.fields) && shown.inQueue && !shown.directorForm, shown ? `${shown.stars.trim()}; only the Secretary's action is offered` : "form did not load");
    if (!ready) return;
    await secretary.eval(`document.querySelector('[data-testid=secretary-approve-run]').click(); true`);
    const needInput = await secretary.waitFor(`!!document.querySelector('[data-testid=secretary-approve-input-error]')`, 8000);
    check(`${runLabel}.ui.needs-note`, needInput && stateOf(A.id) === "secretary_approval", "nothing sent without a note");
    const uiNote = `UI approve ${tag}`.slice(0, 80);
    await setInput(secretary, "secretary-approve-note", uiNote, "HTMLTextAreaElement");
    await secretary.eval(`document.querySelector('[data-testid=secretary-approve-run]').click(); true`);
    const done = await secretary.waitFor(`!!document.querySelector('[data-testid=secretary-approve-success]')`, 15000);
    const doneText = done ? await secretary.eval(`document.querySelector('[data-testid=secretary-approve-success]').textContent`) : "";
    check(`${runLabel}.ui.secretary-approved`, done && doneText.includes(A.reference) && /approved/i.test(doneText) && /end of the first slice/.test(doneText), doneText.slice(0, 110) || "no success note");

    // What the approval changed, in the database and for each reader.
    check(`${runLabel}.db.state-moved`, stateOf(A.id) === "approved" && sql(`SELECT version FROM app.model_application WHERE id = '${A.id}'`) === String(A.version + 1), `approved v${A.version + 1}`);
    const ev = sql(`SELECT action || ':' || from_state || '>' || to_state || ':' || actor_role FROM app.model_application_transition_event WHERE application_id = '${A.id}' AND action = 'secretary_approve'`);
    check(`${runLabel}.db.event`, ev === "secretary_approve:secretary_approval>approved:secretary" && countOf("model_application_transition_event", A.id) === 6, ev);
    check(`${runLabel}.db.approval-record`, sql(`SELECT note FROM app.model_application_secretary_approval WHERE application_id = '${A.id}'`) === uiNote, "the Secretary's note is recorded");
    check(`${runLabel}.db.whole-chain`, sql(`SELECT string_agg(action, ',' ORDER BY version_after) FROM app.model_application_transition_event WHERE application_id = '${A.id}'`) === "confirm_fee,iame_recommend,reviewer_forward,compute_rating,director_recommend,secretary_approve", "six events, one per step, in order");
    check(`${runLabel}.db.six-distinct-actors`, Number(sql(`SELECT count(DISTINCT actor_account_id) FROM app.model_application_transition_event WHERE application_id = '${A.id}'`)) === 6, "six different people took the six steps after submit");
    r = await api(secretary, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    const after = await api(secretary, "GET", `${WEB}/api/runtime/model-applications`, null, null);
    check(`${runLabel}.secretary.no-longer-sees-it`, r.status === 404 && r.body?.error === "not_found" && !(after.body?.items ?? []).some((x) => x.id === A.id), "the stage moved on, so the Secretary's scope no longer includes it");
    r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${A.id}`, null, null);
    check(`${runLabel}.nova.sees-approved-and-rating`, r.status === 200 && r.body?.state === "approved" && r.body?.rating?.stars === 4 && r.body?.rating?.localDemoRating === true, `${r.body?.state}, ${r.body?.rating?.stars} stars (local demonstration)`);
    // WP09.1a: the approval issued the certificate in the same step; the applicant sees it (a local demonstration) and the dashboard shows it.
    const cert = r.body?.certificate;
    check(`${runLabel}.nova.sees-the-certificate`, /^BEE\/RAC\/\d{4}\/\d{5}$/.test(cert?.registrationId ?? "") && cert?.status === "valid" && cert?.stars === 4 && cert?.localDemoCertificate === true, `${cert?.registrationId} ${cert?.status} ${cert?.stars} stars`);
    check(`${runLabel}.db.one-certificate-issued-by-the-secretary-for-three-years`, sql(`SELECT count(*) || '|' || (valid_to = valid_from + interval '3 years' - interval '1 day') || '|' || (issued_by_account_id = '${ids.accountId("bee.secretary")}') || '|' || basis FROM app.certificate WHERE application_id = '${A.id}' GROUP BY valid_from, valid_to, issued_by_account_id, basis`) === "1|true|true|local_demo", sql(`SELECT registration_id || ' ' || valid_from || '..' || valid_to FROM app.certificate WHERE application_id = '${A.id}'`));
    await nova.goto(`${WEB}/app/model-label/model-dashboard?id=${A.id}`);
    const card = await nova.waitFor(`!!document.querySelector('[data-testid=model-app-certificate]')`, 30000);
    check(`${runLabel}.ui.dashboard-shows-the-certificate`, card && (await nova.eval(`document.querySelector('[data-testid=model-app-certificate-registration]').textContent`)) === cert?.registrationId && /local demonstration/i.test(await nova.eval(`document.querySelector('[data-testid=model-app-certificate-demo]').textContent`)), cert?.registrationId ?? "no certificate");
    // WP09.1b: the printable certificate and label, with a QR code that points to the public verification page.
    const openHref = await nova.eval(`document.querySelector('[data-testid=model-app-certificate-open]')?.getAttribute('href') ?? ""`);
    check(`${runLabel}.ui.dashboard-links-to-the-printable-certificate`, openHref === `/app/model-label/label-preview?id=${A.id}`, openHref);
    await nova.goto(`${WEB}/app/model-label/label-preview`);
    const listed = await nova.waitFor(`!!document.querySelector('[data-testid="certdocs-open-${A.reference}"]')`, 30000);
    check(`${runLabel}.ui.certificate-list-has-the-approved-application`, listed, `${A.reference} is listed`);
    await nova.goto(`${WEB}/app/model-label/label-preview?id=${A.id}`);
    const docs = await nova.waitFor(`!!document.querySelector('[data-testid=certificate-document]') && !!document.querySelector('[data-testid=label-document]')`, 30000);
    const verifyUrl = `${WEB}/verify?reg=${encodeURIComponent(cert?.registrationId ?? "")}`;
    const docInfo = docs ? await nova.eval(`(() => { const t = (id) => document.querySelector('[data-testid="' + id + '"]')?.textContent ?? ""; const q = (id) => document.querySelector('[data-testid="' + id + '"]')?.getAttribute("data-qr-text") ?? ""; return JSON.stringify({ reg: t("certificate-registration"), model: t("certificate-model"), validity: t("certificate-validity"), demo: t("certificate-demo"), labelDemo: t("label-demo"), iseer: t("label-iseer"), certQr: q("certificate-qr"), labelQr: q("label-qr"), print: !!document.querySelector('[data-testid=certdocs-print]'), modules: Number(document.querySelector('[data-testid=certificate-qr]')?.getAttribute("data-qr-modules")) }); })()`) : "{}";
    const d = JSON.parse(docInfo);
    check(`${runLabel}.ui.certificate-document`, docs && d.reg === cert?.registrationId && d.model.includes("SA-A-") && /^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} \(valid\)$/.test(d.validity) && /LOCAL DEMONSTRATION/.test(d.demo), `${d.reg} ${d.validity}`);
    check(`${runLabel}.ui.label-document`, docs && d.iseer === "ISEER 4.62" && /not issued by BEE/.test(d.labelDemo) && d.print === true, `${d.iseer}, print button ${d.print}`);
    check(`${runLabel}.ui.both-qr-codes-point-to-the-verification-page`, docs && d.certQr === verifyUrl && d.labelQr === verifyUrl && d.modules >= 21, verifyUrl);
    // WP09.1c: a person with no account follows the QR address and sees the public facts only (the owner's assumption D8).
    const API = `http://127.0.0.1:${process.env.BEE_API_PORT || "8090"}`;
    const plain = async (url) => {
      const res = await fetch(url, { cache: "no-store", headers: { "X-Correlation-Id": `verify-${Date.now()}-${Math.floor(Math.random() * 1e6)}` } });
      const text = await res.text();
      return { status: res.status, json: (() => { try { return JSON.parse(text); } catch { return null; } })(), text, headers: res.headers };
    };
    const regQ = encodeURIComponent(cert?.registrationId ?? "");
    for (const [layer, base, route] of [["spring", `${API}/api/public/verification`, "/api/public/verification"], ["portal", `${WEB}/api/runtime/verification`, "/api/runtime/verification"]]) {
      const found = await plain(`${base}?reg=${regQ}`);
      const e = contract.conforms(doc, route, "GET", found);
      const keys = Object.keys(found.json ?? {}).sort().join(",");
      check(`${runLabel}.public.${layer}-answers-without-a-token`, found.status === 200 && e.length === 0 && found.json?.registrationId === cert?.registrationId && found.json?.status === "valid", `${found.status} ${found.json?.registrationId} ${found.json?.status}${e.length ? " " + e.join("; ") : ""}`);
      check(`${runLabel}.public.${layer}-shows-public-fields-only`, keys === "brandName,category,localDemoCertificate,manufacturer,modelNumber,registrationId,stars,status,validFrom,validTo,verifiedIseer", keys);
      for (const [name, q, status, code] of [["unknown", "BEE%2FRAC%2F2026%2F99999", 404, "not_found"], ["malformed", "x%27%3B%20DROP%20TABLE%20certificate%3B--", 404, "not_found"], ["blank", "%20", 422, "validation_failed"]]) {
        const x = await plain(`${base}?reg=${q}`);
        const ex = contract.conforms(doc, route, "GET", x);
        check(`${runLabel}.public.${layer}-${name}`, x.status === status && x.json?.error === code && ex.length === 0, `${x.status} ${x.json?.error}${ex.length ? " " + ex.join("; ") : ""}`);
      }
    }
    await anon.goto(verifyUrl);
    const anonShown = await anon.waitFor(`document.querySelector('[data-testid=verify-result]')?.getAttribute('data-outcome') === 'valid'`, 30000);
    // The result panel only: the site footer carries BEE's own helpdesk address, which is public and not part of the answer.
    const pageText = anonShown ? await anon.eval(`document.querySelector('[data-testid=verify-result]')?.innerText ?? ''`) : "";
    const maker = sql(`SELECT organisation_name FROM app.certificate WHERE application_id = '${A.id}'`);
    check(`${runLabel}.public.page-shows-valid-registration`, anonShown && pageText.includes(cert?.registrationId ?? "?") && pageText.includes(maker) && /not a BEE certificate/.test(pageText), `${cert?.registrationId} by ${maker}`);
    check(`${runLabel}.public.page-hides-private-details`, anonShown && !pageText.includes(A.reference) && !/@/.test(pageText) && !/nova\.applicant/i.test(pageText), "no application reference or account name on the page");
    await anon.goto(`${WEB}/verify?reg=BEE%2FRAC%2F2026%2F99999`);
    const missing = await anon.waitFor(`document.querySelector('[data-testid=verify-result]')?.getAttribute('data-outcome') === 'not_found'`, 30000);
    check(`${runLabel}.public.page-says-not-found`, missing, "an unknown registration ID is reported as not found");
    // Printing shows the documents and hides the console around them (the browser's print emulation).
    await nova.send("Emulation.setEmulatedMedia", { media: "print" });
    const printed = JSON.parse(await nova.eval(`(() => { const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; }; return JSON.stringify({ aside: shown("aside"), button: shown('[data-testid=certdocs-print]'), cert: shown('[data-testid=certificate-document]'), label: shown('[data-testid=label-document]'), identity: shown('[data-testid=certdocs-identity]') }); })()`));
    await nova.send("Emulation.setEmulatedMedia", { media: "screen" });
    check(`${runLabel}.ui.print-shows-only-the-documents`, printed.cert && printed.label && !printed.aside && !printed.button && !printed.identity, JSON.stringify(printed));
    r = await approveApi(secretary, A.id, approveBody(A.version + 1), key());
    check(`${runLabel}.secretary.cannot-approve-twice`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.db.still-one-approval`, countOf("model_application_secretary_approval", A.id) === 1, "exactly one approval record");

    // Idempotency: a lost-response retry replays the receipt; a different body under the same key is refused.
    const B = await secretaryApp(nova, finance, iame, reviewer, programme, director, createdIds, `SA-B-${tag}`);
    const k = key();
    const body = approveBody(B.version);
    const first = await approveApi(secretary, B.id, body, k);
    const again = await approveApi(secretary, B.id, body, k);
    check(`${runLabel}.secretary.replay`, first.status === 200 && first.body?.toState === "approved" && again.status === 200 && again.replay === "true" && sameBody(first.body, again.body) && countOf("model_application_secretary_approval", B.id) === 1, `replay=${again.replay}`);
    r = await approveApi(secretary, B.id, { ...body, note: `OTHER ${tag}`.slice(0, 40) }, k);
    check(`${runLabel}.secretary.key-conflict`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error ?? ""}`);

    // Numbers rise by one per approval within a category and year (the second approval of this run follows the first).
    const nA = Number(sql(`SELECT sequence_no FROM app.certificate WHERE application_id = '${A.id}'`)), nB = Number(sql(`SELECT sequence_no FROM app.certificate WHERE application_id = '${B.id}'`));
    check(`${runLabel}.db.numbers-rise`, Number.isFinite(nA) && nB > nA, `${nA} then ${nB}`);
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
    const orphanRows = sql(`SELECT (SELECT count(*) FROM app.model_application_rating WHERE application_id NOT IN (SELECT id FROM app.model_application)) + (SELECT count(*) FROM app.model_application_director_recommendation WHERE application_id NOT IN (SELECT id FROM app.model_application)) + (SELECT count(*) FROM app.model_application_secretary_approval WHERE application_id NOT IN (SELECT id FROM app.model_application))`);
    check(`${runLabel}.no-orphan-records`, orphanRows === "0", `orphan rating, recommendation and approval rows=${orphanRows}`);
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
    pages.anon = await openPage(chrome.cdp); // never signs in: the public verification page needs no account
    for (const k of Object.keys(twins)) {
      pages[k] = await openPage(chrome.cdp);
      if (!(await signIn(pages[k], twins[k]))) throw new Error(`${k} sign-in failed`);
    }
    // The disposable twin and the real officer tie on load and the lower account id wins, which is the real officer.
    // Pause the real IAME officer's and Reviewer's roles for the run so the next-officer rule picks the twins this check
    // is signed in as; the finally block restores them exactly. Programme, the Director and the Secretary need no assignment.
    const REAL = [["iame", REAL_IAME], ["reviewer", REAL_REVIEWER]];
    const was = REAL.map(([role, id]) => sql(`SELECT active FROM app.role_assignment WHERE user_id = '${id}' AND role = '${role}'`));
    for (const [role, id] of REAL) sql(`UPDATE app.role_assignment SET active = false WHERE user_id = '${id}' AND role = '${role}'`);
    try {
      await runSecretaryChecks("secretary.run1", pages.nova, pages.finance, pages.iame, pages.reviewer, pages.programme, pages.director, pages.secretary, pages.anon);
      await runSecretaryChecks("secretary.run2", pages.nova, pages.finance, pages.iame, pages.reviewer, pages.programme, pages.director, pages.secretary, pages.anon);
    } finally {
      REAL.forEach(([role, id], i) => sql(`UPDATE app.role_assignment SET active = ${was[i] === "t"} WHERE user_id = '${id}' AND role = '${role}'`));
      check("secretary.real-officers-restored", REAL.every(([role, id], i) => sql(`SELECT active FROM app.role_assignment WHERE user_id = '${id}' AND role = '${role}'`) === was[i]), "real IAME officer and Reviewer roles restored");
    }
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("secretary.run", false, String(e.message)))
  .then(() => {
    console.log(`secretary-approval checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
