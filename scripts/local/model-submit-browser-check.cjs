/* eslint-disable */
/** WP05.1c–d: draft submit → fee_due via BFF behind the evidence gates; baseline-preserving, run twice. */
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

const RUNTIME_SUBMIT = "/api/runtime/model-applications/{id}/submit";

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

function recordSubmit(method, status, code, r) {
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({
    route: RUNTIME_SUBMIT, method, status, code: code ?? "-",
    ok: contract.conforms(doc, RUNTIME_SUBMIT, method, faux).length === 0,
  });
}

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

const DEMO_FEE = { amountInr: "24000.00", feeRuleKey: "RAC:new_model", feeRuleVersion: 2 };

function submitPayload(preview) {
  const f = preview?.submissionFee ?? DEMO_FEE;
  return {
    version: preview.version,
    expectedFee: { amountInr: f.amountInr, feeRuleKey: f.feeRuleKey, feeRuleVersion: f.feeRuleVersion },
  };
}

async function api(page, method, path, body, idem) {
  const headers = { "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) };
  const bodySnippet = body == null ? "undefined" : `JSON.stringify(${JSON.stringify(body)})`;
  return page.eval(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "include", cache: "no-store", headers: ${JSON.stringify(headers)}, body: ${bodySnippet} }).then(async (r) => { const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; }); return { status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null), headers: hs }; })`);
}

async function apiSubmit(page, method, id, body, idem) {
  const r = await api(page, method, `${WEB}/api/runtime/model-applications/${id}/submit`, body, idem);
  const code = r.status >= 400 ? r.body?.error : "-";
  recordSubmit(method, r.status, code, r);
  return r;
}

/** A draft the check is building: PATCH needs the model number and the current version. */
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

/** Everything the evidence gates need: efficiency, an accredited laboratory on a covered date, and a test report. */
async function completeEvidence(page, draft, label) {
  const p = await patchDraft(page, draft, { laboratoryCode: "LAB", testedOn: TESTED_OK, declaredIseer: 4.5 });
  const u = await uploadReport(page, draft.id, label);
  return p.status === 200 && u.status === 201;
}

async function evidenceFormChecks(runLabel, nova, draftId) {
  await nova.goto(`${WEB}/app/model-label/new-model-application?edit=${encodeURIComponent(draftId)}`);
  const loaded = await nova.waitFor(`!!document.querySelector('[data-testid=model-draft-laboratory]') && document.querySelector('[data-testid=model-draft-iseer]').value !== ''`, 15000);
  const shown = loaded ? await nova.eval(`({ lab: document.querySelector('[data-testid=model-draft-laboratory]').value, date: document.querySelector('[data-testid=model-draft-tested-on]').value, iseer: document.querySelector('[data-testid=model-draft-iseer]').value, options: [...document.querySelector('[data-testid=model-draft-laboratory]').options].map((o) => o.value) })`) : null;
  check(`${runLabel}.ui.evidence-fields`, !!shown && shown.lab === "LAB" && shown.date === TESTED_OK && shown.iseer === "4.5" && shown.options.includes("LAB"), shown ? `${shown.lab} ${shown.date} ${shown.iseer}` : "form did not load");
  if (!loaded) return;
  await nova.eval(`(() => {
    const el = document.querySelector('[data-testid=model-draft-iseer]');
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, '3.2');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const dirty = await nova.waitFor(`!!document.querySelector('[data-testid=model-draft-dirty-hint]')`, 8000);
  check(`${runLabel}.ui.evidence-dirty`, dirty, dirty ? "changing an evidence field needs a save before submit" : "no dirty hint");
  await nova.eval(`(() => {
    const el = document.querySelector('[data-testid=model-draft-iseer]');
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, '4.5');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await nova.waitFor(`!document.querySelector('[data-testid=model-draft-dirty-hint]')`, 8000);
  await nova.eval(`document.querySelector('[data-testid=model-draft-submit]').click(); true`);
  const open = await nova.waitFor(`!!document.querySelector('[data-testid=model-submit-gates]')`, 12000);
  const gates = open ? await nova.eval(`[...document.querySelectorAll('[data-testid=model-submit-gates] li')].map((li) => li.getAttribute('data-testid').replace('model-submit-gate-', '') + ':' + li.getAttribute('data-met'))`) : [];
  check(`${runLabel}.ui.gate-checklist`, gates.length === 6 && gates.every((g) => g.endsWith(":true")), gates.join(" ") || "no checklist");
}

async function dirtyAfterPreviewClosed(runLabel, nova, draftId) {
  await nova.goto(`${WEB}/app/model-label/new-model-application?edit=${encodeURIComponent(draftId)}`);
  if (!(await nova.waitFor(`!!document.querySelector('[data-testid=model-draft-submit]')`))) {
    check(`${runLabel}.dirty-after-preview`, false, "edit form did not load");
    return;
  }
  await nova.eval(`document.querySelector('[data-testid=model-draft-submit]').click(); true`);
  if (!(await nova.waitFor(`!!document.querySelector('[data-testid=model-submit-confirm]')`, 12000))) {
    check(`${runLabel}.dirty-after-preview`, false, "confirm did not open");
    return;
  }
  await nova.eval(`(() => {
    const el = document.querySelector('[data-testid=model-draft-model-number]');
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, 'DIRTY-AFTER-${runLabel}');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const confirmOpen = await nova.eval(`!!document.querySelector('[data-testid=model-submit-confirm]')`);
  const hint = await nova.waitFor(`!!document.querySelector('[data-testid=model-draft-dirty-hint]')`, 8000);
  check(`${runLabel}.dirty-after-preview`, hint && !confirmOpen, hint ? "confirm closed after edit" : "no dirty hint after preview");
}

async function dirtyFormBlocked(runLabel, nova, draftId) {
  await nova.goto(`${WEB}/app/model-label/new-model-application?edit=${encodeURIComponent(draftId)}`);
  // The draft loads after the form renders; editing before it arrives would be overwritten by the load, not seen as a change.
  const loaded = await nova.waitFor(`!!document.querySelector('[data-testid=model-draft-model-number]') && document.querySelector('[data-testid=model-draft-model-number]').value !== ''`, 15000);
  if (!loaded) {
    check(`${runLabel}.dirty-form`, false, "edit form did not load");
    return;
  }
  await nova.eval(`(() => {
    const el = document.querySelector('[data-testid=model-draft-model-number]');
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, 'DIRTY-${runLabel}');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await nova.eval(`document.querySelector('[data-testid=model-draft-submit]').click(); true`);
  const hint = await nova.waitFor(`!!document.querySelector('[data-testid=model-draft-dirty-hint]')`, 8000);
  const confirmOpen = await nova.eval(`!!document.querySelector('[data-testid=model-submit-confirm]')`);
  check(`${runLabel}.dirty-form`, hint && !confirmOpen, hint ? "confirm blocked" : "no dirty hint");
}

async function runSubmitChecks(runLabel, nova, pixel) {
  const createdIds = [];
  const novaAcct = ids.accountId("nova.applicant");
  const before = modelBaseline();
  const blobsBefore = blobsNow();
  try {
    const mkDraft = async (page, model) => {
      const r = await api(page, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: model }, key());
      if (r.body?.id) createdIds.push(r.body.id);
      return r;
    };

    let r = await mkDraft(nova, `NC-SUB-${runLabel}-${Date.now()}`);
    const novaDraft = r.body?.id;
    check(`${runLabel}.nova.create-draft`, r.status === 201 && r.body?.state === "draft", r.body?.reference);

    await dirtyFormBlocked(runLabel, nova, novaDraft);

    // WP05.1d evidence gates, one at a time, against the real seeded masters.
    const D = { id: novaDraft, version: r.body.version, model: r.body.modelNumber };
    r = await apiSubmit(nova, "GET", D.id, null, null);
    const g0 = r.body?.evidenceGates ?? [];
    check(`${runLabel}.nova.gates-preview-incomplete`, r.status === 200 && r.body?.ready === false && g0.length === 6 && g0[0]?.code === "test_report_required" && g0.filter((g) => g.met).map((g) => g.code).join() === "duplicate_model", g0.filter((g) => !g.met).map((g) => g.code).join(","));
    const gateStep = async (code, status, why) => {
      const pv = await apiSubmit(nova, "GET", D.id, null, null);
      const sr = await apiSubmit(nova, "POST", D.id, submitPayload(pv.body), key());
      check(`${runLabel}.nova.gate-${why}`, sr.status === status && sr.body?.error === code, `${sr.status} ${sr.body?.error ?? ""}`);
    };
    await gateStep("test_report_required", 422, "test-report");
    await uploadReport(nova, D.id, `gate-${runLabel}`);
    await gateStep("declared_efficiency_required", 422, "efficiency");
    await patchDraft(nova, D, { declaredIseer: 4.5 });
    await gateStep("test_date_invalid", 422, "test-date");
    await patchDraft(nova, D, { testedOn: TESTED_SUSPENDED });
    await gateStep("laboratory_not_accredited", 422, "no-laboratory");
    await patchDraft(nova, D, { laboratoryCode: "LAB" });
    await gateStep("laboratory_not_accredited", 422, "laboratory-suspended");
    await patchDraft(nova, D, { testedOn: TESTED_OK });
    r = await apiSubmit(nova, "GET", D.id, null, null);
    check(`${runLabel}.nova.gates-preview-complete`, r.status === 200 && r.body?.ready === true && (r.body?.evidenceGates ?? []).every((g) => g.met), "all six met");

    // Malformed evidence writes are refused and change nothing.
    const versionBefore = D.version;
    const farFuture = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    for (const [name, fields] of [["future-date", { testedOn: farFuture }], ["unknown-laboratory", { laboratoryCode: "NOPE" }], ["zero-efficiency", { declaredIseer: 0 }], ["text-efficiency", { declaredIseer: "4.5" }], ["three-decimals", { declaredIseer: 4.555 }]]) {
      const bad = await patchDraft(nova, D, fields);
      check(`${runLabel}.nova.evidence-${name}`, bad.status === 422 && bad.body?.error === "validation_failed", `${bad.status} ${bad.body?.error ?? ""}`);
    }
    r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${D.id}`, null, null);
    check(`${runLabel}.nova.evidence-unchanged`, r.body?.version === versionBefore && r.body?.laboratoryCode === "LAB" && r.body?.testedOn === TESTED_OK && r.body?.declaredIseer === 4.5, `v${r.body?.version} ${r.body?.laboratoryCode} ${r.body?.testedOn} ${r.body?.declaredIseer}`);
    // The form shows what was saved and treats an unsaved evidence change as dirty.
    await evidenceFormChecks(runLabel, nova, D.id);

    r = await apiSubmit(nova, "GET", novaDraft, null, null);
    check(`${runLabel}.nova.preview`, r.status === 200 && r.body?.ready === true && r.body?.submissionFee?.localDemoFee === true && r.body?.draftSummary?.modelNumber, r.body?.submissionFee?.label);

    await dirtyAfterPreviewClosed(runLabel, nova, novaDraft);

    const preview = r.body;
    r = await apiSubmit(nova, "POST", novaDraft, { version: preview.version, expectedFee: { amountInr: "99999.00", feeRuleKey: DEMO_FEE.feeRuleKey, feeRuleVersion: DEMO_FEE.feeRuleVersion } }, key());
    check(`${runLabel}.nova.fee-preview-conflict`, r.status === 409 && r.body?.error === "fee_preview_conflict", r.body?.error);
    check(`${runLabel}.nova.fee-conflict-still-draft`, sql(`SELECT state FROM app.model_application WHERE id = '${novaDraft}'`) === "draft", "no transition");

    const sk = key();
    r = await apiSubmit(nova, "POST", novaDraft, submitPayload(preview), sk);
    check(`${runLabel}.nova.submit`, r.status === 200 && r.body?.state === "fee_due" && r.body?.submissionFee?.amountInr === "24000.00", `${r.status} v${r.body?.version}`);

    const snap = sql(`SELECT accreditation_rule_key || ':' || accreditation_version || '|' || standard_rule_key || ':' || standard_version FROM app.model_application WHERE id = '${novaDraft}'`);
    check(`${runLabel}.nova.evidence-snapshot`, snap === "LAB:RAC:3|RAC:performance_test:2", snap);
    r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${novaDraft}`, null, null);
    check(`${runLabel}.nova.evidence-in-read`, r.body?.laboratoryCode === "LAB" && r.body?.testedOn === TESTED_OK && r.body?.declaredIseer === 4.5, `${r.body?.laboratoryCode} ${r.body?.testedOn}`);
    const frozen = await patchDraft(nova, { id: novaDraft, version: r.body.version, model: r.body.modelNumber }, { declaredIseer: 1 });
    check(`${runLabel}.nova.evidence-frozen-after-submit`, frozen.status === 403 && frozen.body?.error === "not_editable", `${frozen.status} ${frozen.body?.error ?? ""}`);

    // A second draft with the same brand and model number (different case and spacing) may exist as a draft but not be submitted.
    const dupRes = await mkDraft(nova, ` ${D.model.toLowerCase()} `);
    check(`${runLabel}.nova.duplicate-draft-allowed`, dupRes.status === 201, "drafts do not claim the number");
    const dup = { id: dupRes.body.id, version: dupRes.body.version, model: dupRes.body.modelNumber };
    check(`${runLabel}.nova.duplicate-evidence`, await completeEvidence(nova, dup, `dup-${runLabel}`), "evidence complete on the duplicate");
    const dp = await apiSubmit(nova, "GET", dup.id, null, null);
    check(`${runLabel}.nova.duplicate-preview`, dp.status === 200 && dp.body?.ready === false && dp.body?.evidenceGates?.find((g) => g.code === "duplicate_model")?.met === false, "only the uniqueness check is unmet");
    r = await apiSubmit(nova, "POST", dup.id, submitPayload(dp.body), key());
    check(`${runLabel}.nova.duplicate-model`, r.status === 409 && r.body?.error === "duplicate_model", `${r.status} ${r.body?.error ?? ""}`);
    check(`${runLabel}.nova.duplicate-still-draft`, sql(`SELECT state FROM app.model_application WHERE id = '${dup.id}'`) === "draft", "no transition");

    r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${novaDraft}`, null, null);
    check(`${runLabel}.nova.fee-after-reload`, r.status === 200 && r.body?.submissionFee?.amountInr === "24000.00", r.body?.submissionFee?.label);

    const ev = sql(`SELECT count(*) FROM app.model_application_submission_event WHERE application_id = '${novaDraft}'`);
    const fee = sql(`SELECT count(*) FROM app.model_application_fee_snapshot WHERE application_id = '${novaDraft}'`);
    check(`${runLabel}.nova.one-event-fee`, ev === "1" && fee === "1", `events=${ev} fees=${fee}`);

    const immutErr = sql(`DELETE FROM app.model_application_fee_snapshot WHERE application_id = '${novaDraft}'`, true);
    check(`${runLabel}.nova.immutable-fee`, /append-only|55000/i.test(immutErr), immutErr.slice(0, 80) || "runtime DELETE refused");

    r = await apiSubmit(nova, "POST", novaDraft, submitPayload(preview), sk);
    check(`${runLabel}.nova.submit-replay`, r.status === 200 && r.replay === "true" && ev === "1" && fee === "1", "idempotent replay");

    const appCleanupDeny = sqlApp(`SELECT app.app_disposable_model_cleanup(ARRAY['${NOVA_FEE_DUE}']::uuid[])`, true);
    check(`${runLabel}.nova.runtime-cleanup-denied`, /maintenance role|permission denied|42501/i.test(appCleanupDeny), appCleanupDeny.slice(0, 72));

    const memBefore = sql(`SELECT organisation_id FROM app.organisation_membership WHERE user_id = '${novaAcct}'`);
    sql(`UPDATE app.organisation_membership SET organisation_id = '${PIXEL_ORG}' WHERE user_id = '${novaAcct}'`);
    try {
      r = await apiSubmit(nova, "POST", novaDraft, submitPayload(preview), sk);
      check(`${runLabel}.nova.replay-after-org-move`, r.status === 404 && r.body?.error === "not_found", r.body?.error);
    } finally {
      sql(`UPDATE app.organisation_membership SET organisation_id = '${memBefore}' WHERE user_id = '${novaAcct}'`);
    }

    r = await mkDraft(pixel, `AU-SUB-${runLabel}-${Date.now()}`);
    const pixelDraft = r.body?.id;
    check(`${runLabel}.pixel.agency-draft`, r.status === 201, "agency filing");
    check(`${runLabel}.pixel.evidence`, await completeEvidence(pixel, { id: pixelDraft, version: r.body.version, model: r.body.modelNumber }, `px-${runLabel}`), "agency completes the evidence");
    const pxPrev = await apiSubmit(pixel, "GET", pixelDraft, null, null);
    r = await apiSubmit(pixel, "POST", pixelDraft, submitPayload(pxPrev.body), key());
    check(`${runLabel}.pixel.submit`, r.status === 200 && r.body?.state === "fee_due", r.body?.state);

    r = await apiSubmit(nova, "POST", PIXEL_APP, { version: 0, expectedFee: { amountInr: "24000.00", feeRuleKey: "RAC:new_model", feeRuleVersion: 2 } }, key());
    check(`${runLabel}.nova.cross-org-submit`, r.status === 404 && r.body?.error === "not_found", r.body?.error);

    const other = await mkDraft(nova, `NC-OTHER-${runLabel}`);
    const op = await apiSubmit(nova, "GET", other.body.id, null, null);
    r = await apiSubmit(pixel, "POST", other.body.id, submitPayload(op.body), key());
    check(`${runLabel}.pixel.cross-org-submit`, r.status === 404 && r.body?.error === "not_found", "agency on nova draft");

    r = await apiSubmit(nova, "POST", NOVA_FEE_DUE, { version: 1, expectedFee: { amountInr: "24000.00", feeRuleKey: "RAC:new_model", feeRuleVersion: 2 } }, key());
    check(`${runLabel}.nova.wrong-state`, r.status === 403 && r.body?.error === "not_submittable", "fee_due not submittable");

    const staleDraft = await mkDraft(nova, `NC-STALE-${runLabel}`);
    const sp = await apiSubmit(nova, "GET", staleDraft.body.id, null, null);
    r = await apiSubmit(nova, "POST", staleDraft.body.id, { ...submitPayload(sp.body), version: 9 }, key());
    check(`${runLabel}.nova.stale-version`, r.status === 409 && r.body?.error === "version_conflict", r.body?.error);

    r = await apiSubmit(nova, "POST", novaDraft, null, null);
    check(`${runLabel}.nova.missing-key`, r.status === 422 && r.body?.error === "idempotency_key_required", r.body?.error);

    const revDraft = await mkDraft(nova, `NC-REV-${runLabel}`);
    sql("UPDATE app.brand SET status = 'revoked' WHERE id = '" + NOVA_COOL + "'");
    try {
      r = await apiSubmit(nova, "POST", revDraft.body.id, { version: 0, expectedFee: DEMO_FEE }, key());
      check(`${runLabel}.nova.revoked-brand`, r.status === 403 && r.body?.error === "brand_not_permitted", r.body?.error);
    } finally {
      sql("UPDATE app.brand SET status = 'active' WHERE id = '" + NOVA_COOL + "'");
    }

  } finally {
    cleanupDisposable(createdIds);
    for (const f of blobsNow()) {
      if (!blobsBefore.has(f)) {
        try { fs.unlinkSync(path.join(STORE, f)); } catch { /* ignore */ }
      }
    }
    const after = modelBaseline();
    check(`${runLabel}.baseline-preserved`, before === after, before === after ? "seed rows unchanged" : `drift ${before.slice(0, 30)} vs ${after.slice(0, 30)}`);
  }
}

async function main() {
  const chrome = await launchChrome();
  try {
    const novaTwin = ids.name("nova.applicant");
    const pixelTwin = ids.name("pixel.applicant");
    await totp.ensureEnrolled(novaTwin);
    await totp.ensureEnrolled(pixelTwin);
    const nova = await openPage(chrome.cdp);
    if (!(await signIn(nova, novaTwin))) throw new Error("Nova sign-in failed");
    const pixel = await openPage(chrome.cdp);
    if (!(await signIn(pixel, pixelTwin))) throw new Error("Pixel sign-in failed");
    await runSubmitChecks("submit.run1", nova, pixel);
    await runSubmitChecks("submit.run2", nova, pixel);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("submit.run", false, String(e.message)))
  .then(() => {
    console.log(`model-submit checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
