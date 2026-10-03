/* eslint-disable */
/** WP05.1b: draft create/edit through BFF + Spring; baseline-preserving, run twice. */
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { USERS } = require("../../local/generate-fixtures.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");
const contract = require("./contract-lib.cjs");

const doc = contract.load();
const RUNTIME_LIST = "/api/runtime/model-applications";
const RUNTIME_DETAIL = "/api/runtime/model-applications/{id}";
const RUNTIME_BRANDS = "/api/runtime/model-applications/eligible-brands";

const NOVA_COOL = "00000000-0000-4000-d000-000000000001";
const PIXEL_APP = "00000000-0000-4000-c000-000000000003";
const key = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);

let pass = 0, fail = 0;
function check(id, ok, detail) { const r = ok ? "PASS" : "FAIL"; ok ? pass++ : fail++; console.log(`${r.padEnd(4)} ${id.padEnd(42)} ${detail}`); }

function sql(q) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${process.env.BEE_APP_DB_PASSWORD || "bee-local-app"}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
}

function modelBaseline() {
  return sql("SELECT count(*)::text || '|' || coalesce(string_agg(reference || ':' || state || ':' || version, ',' ORDER BY reference), '') FROM app.model_application");
}

function twinAccountIds() {
  return USERS.map((u) => `'${ids.accountId(u.username)}'`).join(",");
}

function cleanupDisposable(createdIds) {
  if (createdIds.length) {
    const inList = createdIds.map((id) => `'${id}'`).join(",");
    sql(`DELETE FROM app.model_application WHERE id IN (${inList})`);
  }
  sql(`DELETE FROM app.idempotency_record WHERE account_id IN (${twinAccountIds()})`);
}

function runtimeRoute(method, path) {
  if (path.includes("/eligible-brands")) return RUNTIME_BRANDS;
  if (method === "PATCH") return RUNTIME_DETAIL;
  if (method === "POST" && path.replace(/\/$/, "").endsWith("/model-applications")) return RUNTIME_LIST;
  if (method === "GET" && path.includes("/model-applications/") && !path.includes("eligible-brands")) return RUNTIME_DETAIL;
  if (method === "GET" && path.endsWith("/model-applications")) return RUNTIME_LIST;
  return RUNTIME_LIST;
}

function recordRuntime(method, path, r) {
  const route = runtimeRoute(method, path);
  const code = r.status >= 400 ? (r.body?.error ?? "-") : "-";
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route, method, status: r.status, code, ok: contract.conforms(doc, route, method, faux).length === 0 });
}

async function api(page, method, path, body, idem) {
  const headers = { "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) };
  const bodySnippet = body == null ? "undefined" : `JSON.stringify(${JSON.stringify(body)})`;
  const r = await page.eval(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "include", cache: "no-store", headers: ${JSON.stringify(headers)}, body: ${bodySnippet} }).then(async (r) => { const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; }); return { status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null), headers: hs }; })`);
  recordRuntime(method, path, r);
  return r;
}

async function runDraftChecks(runLabel, nova, pixel) {
  const createdIds = [];
  const before = modelBaseline();
  try {
    let r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/eligible-brands`, null, null);
    check(`${runLabel}.nova.eligible-brands`, r.status === 200 && r.body?.count >= 1 && r.body.items.some((b) => b.brandId === NOVA_COOL), `status ${r.status}, count ${r.body?.count}`);

    r = await api(pixel, "GET", `${WEB}/api/runtime/model-applications/eligible-brands`, null, null);
    check(`${runLabel}.pixel.eligible-brands`, r.status === 200 && r.body.items.some((b) => b.principalOrganisation === "NOVA"), "principal NOVA for agency");

    const createBody = { brandId: NOVA_COOL, category: "RAC", modelNumber: `NC-DRAFT-${runLabel}-${Date.now()}` };
    const k1 = key();
    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications`, createBody, k1);
    const createdId = r.body?.id;
    if (createdId) createdIds.push(createdId);
    check(`${runLabel}.nova.create`, r.status === 201 && r.body?.state === "draft" && r.body?.brandId === NOVA_COOL, `${r.status} ref ${r.body?.reference}`);

    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications`, createBody, k1);
    check(`${runLabel}.nova.create-replay`, r.status === 201 && r.replay === "true" && r.body?.id === createdId, "Idempotency-Replayed, same id");

    const lostKey = key();
    const lostBody = { brandId: NOVA_COOL, category: "RAC", modelNumber: `NC-LOST-${runLabel}-${Date.now()}` };
    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications`, lostBody, lostKey);
    const lostId = r.body?.id;
    if (lostId) createdIds.push(lostId);
    check(`${runLabel}.nova.lost-response-first`, r.status === 201 && lostId, "first POST succeeded");
    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications`, lostBody, lostKey);
    const rowCount = sql(`SELECT count(*) FROM app.model_application WHERE model_number = '${lostBody.modelNumber.replace(/'/g, "''")}'`);
    check(`${runLabel}.nova.lost-response-retry`, r.status === 201 && r.replay === "true" && rowCount === "1", `retry replay, rows=${rowCount}`);

    r = await api(nova, "PATCH", `${WEB}/api/runtime/model-applications/${createdId}`, { version: 0, category: "RAC", modelNumber: "NC-EDIT-1" }, key());
    check(`${runLabel}.nova.edit-draft`, r.status === 200 && r.body?.modelNumber === "NC-EDIT-1" && r.body?.version === 1, `version ${r.body?.version}`);

    r = await api(nova, "PATCH", `${WEB}/api/runtime/model-applications/${createdId}`, { version: 0, category: "RAC", modelNumber: "NC-STALE" }, key());
    check(`${runLabel}.nova.stale-version`, r.status === 409 && r.body?.error === "version_conflict", r.body?.error);

    r = await api(nova, "PATCH", `${WEB}/api/runtime/model-applications/${PIXEL_APP}`, { version: 0, category: "RAC", modelNumber: "X" }, key());
    check(`${runLabel}.nova.cross-org-edit`, r.status === 404 && r.body?.error === "not_found", "cross-org patch");

    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications`, { brandId: "00000000-0000-4000-d000-000000009999", category: "RAC", modelNumber: "BAD" }, key());
    check(`${runLabel}.nova.wrong-brand`, r.status === 403 && r.body?.error === "brand_not_permitted", r.body?.error);

    sql("UPDATE app.brand SET status = 'revoked' WHERE id = '" + NOVA_COOL + "'");
    try {
      r = await api(pixel, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: `AU-BAD-${runLabel}` }, key());
      check(`${runLabel}.pixel.revoked-brand`, r.status === 403 && r.body?.error === "brand_not_permitted", "revoked brand");
    } finally {
      sql("UPDATE app.brand SET status = 'active' WHERE id = '" + NOVA_COOL + "'");
    }

    sql("UPDATE app.agency_authorisation SET valid_from = '2020-01-01', valid_to = '2025-01-01' WHERE id = '00000000-0000-4000-e000-000000000001'");
    try {
      r = await api(pixel, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: `AU-EXP-${runLabel}` }, key());
      check(`${runLabel}.pixel.expired-auth`, r.status === 403 && r.body?.error === "brand_not_permitted", "expired authorisation");
    } finally {
      sql("UPDATE app.agency_authorisation SET valid_from = '2026-01-01', valid_to = NULL WHERE id = '00000000-0000-4000-e000-000000000001'");
    }

    r = await api(pixel, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: `AU-DRAFT-${runLabel}` }, key());
    if (r.body?.id) createdIds.push(r.body.id);
    check(`${runLabel}.pixel.create`, r.status === 201 && r.body?.principalOrganisation === "NOVA", `filing PIXEL principal ${r.body?.principalOrganisation}`);

    const legModel = `LEG-${runLabel}-${Date.now()}`;
    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: legModel }, key());
    const legId = r.body?.id;
    if (legId) createdIds.push(legId);
    sql(`UPDATE app.model_application SET brand_id = NULL, principal_organisation_id = NULL WHERE id = '${legId}'`);
    r = await api(nova, "PATCH", `${WEB}/api/runtime/model-applications/${legId}`, { version: 0, category: "RAC", modelNumber: `${legModel}-recon` }, key());
    const reconciled = sql(`SELECT brand_id::text || '|' || brand_name || '|' || coalesce(principal_organisation_id::text, '') FROM app.model_application WHERE id = '${legId}'`);
    check(`${runLabel}.nova.legacy-unique-reconcile`, r.status === 200 && reconciled === `${NOVA_COOL}|Nova Cool|00000000-0000-4000-b000-000000000001`, `PATCH without brandId -> ${r.status}`);

    const EXTRA_BRAND = "00000000-0000-4000-d000-0000000000f2";
    sql(`INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note) VALUES ('${EXTRA_BRAND}', 'Nova Warm', '00000000-0000-4000-b000-000000000001', 'active', 'test', 'synthetic', 'disposable') ON CONFLICT (id) DO NOTHING`);
    try {
      sql(`UPDATE app.model_application SET brand_id = NULL, principal_organisation_id = NULL, brand_name = 'Legacy Mismatch', version = 1 WHERE id = '${legId}'`);
      r = await api(nova, "PATCH", `${WEB}/api/runtime/model-applications/${legId}`, { version: 1, category: "RAC", modelNumber: `${legModel}-bad` }, key());
      const still = sql(`SELECT brand_id IS NULL AND brand_name = 'Legacy Mismatch' FROM app.model_application WHERE id = '${legId}'`);
      check(`${runLabel}.nova.legacy-mismatch-blocked`, r.status === 422 && r.body?.error === "validation_failed" && still === "t", `${r.status} ${r.body?.error}; row unchanged`);
      r = await api(nova, "PATCH", `${WEB}/api/runtime/model-applications/${legId}`, { version: 1, category: "RAC", modelNumber: `${legModel}-pick`, brandId: NOVA_COOL }, key());
      const picked = sql(`SELECT brand_id::text || '|' || brand_name FROM app.model_application WHERE id = '${legId}'`);
      check(`${runLabel}.nova.legacy-explicit-brand`, r.status === 200 && picked === `${NOVA_COOL}|Nova Cool`, "explicit brandId after ambiguous legacy name");
    } finally {
      sql(`DELETE FROM brand WHERE id = '${EXTRA_BRAND}'`);
    }

    const legacy = sql("SELECT brand_id IS NULL FROM app.model_application WHERE reference = 'LOCAL-MA-0002'");
    check(`${runLabel}.legacy-rows-preserved`, legacy === "t", "fee_due row still without brand_id link");

  } finally {
    cleanupDisposable(createdIds);
    const after = modelBaseline();
    check(`${runLabel}.baseline-preserved`, before === after, before === after ? "model_application snapshot restored" : `before ${before.slice(0, 40)}… after ${after.slice(0, 40)}…`);
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

    await runDraftChecks("drafts.run1", nova, pixel);
    await runDraftChecks("drafts.run2", nova, pixel);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("drafts.run", false, String(e.message)))
  .then(() => {
    console.log(`model-drafts checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
