/* eslint-disable */
/** WP05.1c: draft submit → fee_due via BFF; baseline-preserving, run twice. */
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { USERS } = require("../../local/generate-fixtures.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");

const NOVA_COOL = "00000000-0000-4000-d000-000000000001";
const PIXEL_APP = "00000000-0000-4000-c000-000000000003";
const NOVA_FEE_DUE = "00000000-0000-4000-c000-000000000002";
const PIXEL_ORG = "00000000-0000-4000-b000-000000000002";
const key = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);

let pass = 0, fail = 0;
function check(id, ok, detail) { const r = ok ? "PASS" : "FAIL"; ok ? pass++ : fail++; console.log(`${r.padEnd(4)} ${id.padEnd(44)} ${detail}`); }

function sql(q, allowFail = false) {
  try {
    return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${process.env.BEE_APP_DB_PASSWORD || "bee-local-app"}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
  } catch (e) {
    if (allowFail) return (e.stderr?.toString() || e.message || "").trim();
    throw e;
  }
}

function modelBaseline() {
  return sql("SELECT count(*)::text || '|' || coalesce(string_agg(reference || ':' || state || ':' || version, ',' ORDER BY reference), '') FROM app.model_application");
}

function twinAccountIds() {
  return USERS.map((u) => `'${ids.accountId(u.username)}'`).join(",");
}

function cleanupDisposable(createdIds) {
  if (createdIds.length) {
    const arr = createdIds.map((id) => `'${id}'`).join(",");
    sql(`SELECT app.app_disposable_model_cleanup(ARRAY[${arr}]::uuid[])`);
  }
  sql(`DELETE FROM app.idempotency_record WHERE account_id IN (${twinAccountIds()})`);
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
  return page.eval(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "include", cache: "no-store", headers: ${JSON.stringify(headers)}, body: ${bodySnippet} }).then(async (r) => ({ status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null) }))`);
}

async function dirtyFormBlocked(runLabel, nova, draftId) {
  await nova.goto(`${WEB}/app/model-label/new-model-application?edit=${encodeURIComponent(draftId)}`);
  const loaded = await nova.waitFor(`!!document.querySelector('[data-testid=model-draft-model-number]')`);
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

    r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${novaDraft}/submit`, null, null);
    check(`${runLabel}.nova.preview`, r.status === 200 && r.body?.ready === true && r.body?.submissionFee?.localDemoFee === true && r.body?.draftSummary?.modelNumber, r.body?.submissionFee?.label);

    const preview = r.body;
    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications/${novaDraft}/submit`, { version: preview.version, expectedFee: { amountInr: "99999.00", feeRuleKey: DEMO_FEE.feeRuleKey, feeRuleVersion: DEMO_FEE.feeRuleVersion } }, key());
    check(`${runLabel}.nova.fee-preview-conflict`, r.status === 409 && r.body?.error === "fee_preview_conflict", r.body?.error);
    check(`${runLabel}.nova.fee-conflict-still-draft`, sql(`SELECT state FROM app.model_application WHERE id = '${novaDraft}'`) === "draft", "no transition");

    const sk = key();
    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications/${novaDraft}/submit`, submitPayload(preview), sk);
    check(`${runLabel}.nova.submit`, r.status === 200 && r.body?.state === "fee_due" && r.body?.submissionFee?.amountInr === "24000.00", `${r.status} v${r.body?.version}`);

    r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${novaDraft}`, null, null);
    check(`${runLabel}.nova.fee-after-reload`, r.status === 200 && r.body?.submissionFee?.amountInr === "24000.00", r.body?.submissionFee?.label);

    const ev = sql(`SELECT count(*) FROM app.model_application_submission_event WHERE application_id = '${novaDraft}'`);
    const fee = sql(`SELECT count(*) FROM app.model_application_fee_snapshot WHERE application_id = '${novaDraft}'`);
    check(`${runLabel}.nova.one-event-fee`, ev === "1" && fee === "1", `events=${ev} fees=${fee}`);

    const immutErr = sql(`DELETE FROM app.model_application_fee_snapshot WHERE application_id = '${novaDraft}'`, true);
    check(`${runLabel}.nova.immutable-fee`, /append-only|55000/i.test(immutErr), immutErr.slice(0, 80) || "runtime DELETE refused");

    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications/${novaDraft}/submit`, submitPayload(preview), sk);
    check(`${runLabel}.nova.submit-replay`, r.status === 200 && r.replay === "true" && ev === "1" && fee === "1", "idempotent replay");

    const memBefore = sql(`SELECT organisation_id FROM app.organisation_membership WHERE user_id = '${novaAcct}'`);
    sql(`UPDATE app.organisation_membership SET organisation_id = '${PIXEL_ORG}' WHERE user_id = '${novaAcct}'`);
    try {
      r = await api(nova, "POST", `${WEB}/api/runtime/model-applications/${novaDraft}/submit`, submitPayload(preview), sk);
      check(`${runLabel}.nova.replay-after-org-move`, r.status === 404 && r.body?.error === "not_found", r.body?.error);
    } finally {
      sql(`UPDATE app.organisation_membership SET organisation_id = '${memBefore}' WHERE user_id = '${novaAcct}'`);
    }

    r = await mkDraft(pixel, `AU-SUB-${runLabel}-${Date.now()}`);
    const pixelDraft = r.body?.id;
    check(`${runLabel}.pixel.agency-draft`, r.status === 201, "agency filing");
    const pxPrev = await api(pixel, "GET", `${WEB}/api/runtime/model-applications/${pixelDraft}/submit`, null, null);
    r = await api(pixel, "POST", `${WEB}/api/runtime/model-applications/${pixelDraft}/submit`, submitPayload(pxPrev.body), key());
    check(`${runLabel}.pixel.submit`, r.status === 200 && r.body?.state === "fee_due", r.body?.state);

    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications/${PIXEL_APP}/submit`, { version: 0, expectedFee: { amountInr: "24000.00", feeRuleKey: "RAC:new_model", feeRuleVersion: 2 } }, key());
    check(`${runLabel}.nova.cross-org-submit`, r.status === 404 && r.body?.error === "not_found", r.body?.error);

    const other = await mkDraft(nova, `NC-OTHER-${runLabel}`);
    const op = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${other.body.id}/submit`, null, null);
    r = await api(pixel, "POST", `${WEB}/api/runtime/model-applications/${other.body.id}/submit`, submitPayload(op.body), key());
    check(`${runLabel}.pixel.cross-org-submit`, r.status === 404 && r.body?.error === "not_found", "agency on nova draft");

    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications/${NOVA_FEE_DUE}/submit`, { version: 1, expectedFee: { amountInr: "24000.00", feeRuleKey: "RAC:new_model", feeRuleVersion: 2 } }, key());
    check(`${runLabel}.nova.wrong-state`, r.status === 403 && r.body?.error === "not_submittable", "fee_due not submittable");

    const staleDraft = await mkDraft(nova, `NC-STALE-${runLabel}`);
    const sp = await api(nova, "GET", `${WEB}/api/runtime/model-applications/${staleDraft.body.id}/submit`, null, null);
    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications/${staleDraft.body.id}/submit`, { ...submitPayload(sp.body), version: 9 }, key());
    check(`${runLabel}.nova.stale-version`, r.status === 409 && r.body?.error === "version_conflict", r.body?.error);

    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications/${novaDraft}/submit`, null, null);
    check(`${runLabel}.nova.missing-key`, r.status === 422 && r.body?.error === "idempotency_key_required", r.body?.error);

    const revDraft = await mkDraft(nova, `NC-REV-${runLabel}`);
    sql("UPDATE app.brand SET status = 'revoked' WHERE id = '" + NOVA_COOL + "'");
    try {
      r = await api(nova, "POST", `${WEB}/api/runtime/model-applications/${revDraft.body.id}/submit`, { version: 0, expectedFee: DEMO_FEE }, key());
      check(`${runLabel}.nova.revoked-brand`, r.status === 403 && r.body?.error === "brand_not_permitted", r.body?.error);
    } finally {
      sql("UPDATE app.brand SET status = 'active' WHERE id = '" + NOVA_COOL + "'");
    }

  } finally {
    cleanupDisposable(createdIds);
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
