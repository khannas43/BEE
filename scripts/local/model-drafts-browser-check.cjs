/* eslint-disable */
/** WP05.1b: draft create/edit through the real BFF and Spring API (headless Chrome + Keycloak twins). */
const fs = require("fs");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");

const NOVA_COOL = "00000000-0000-4000-d000-000000000001";
const DRAFT1 = "00000000-0000-4000-c000-000000000001";
const PIXEL_APP = "00000000-0000-4000-c000-000000000003";
const key = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);

let pass = 0, fail = 0;
function check(id, ok, detail) { const r = ok ? "PASS" : "FAIL"; ok ? pass++ : fail++; console.log(`${r.padEnd(4)} ${id.padEnd(42)} ${detail}`); }

function sql(q) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${process.env.BEE_APP_DB_PASSWORD || "bee-local-app"}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
}

async function api(page, method, path, body, idem) {
  const headers = { "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) };
  const bodySnippet = body == null ? "undefined" : `JSON.stringify(${JSON.stringify(body)})`;
  return page.eval(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "include", cache: "no-store", headers: ${JSON.stringify(headers)}, body: ${bodySnippet} }).then(async (r) => ({ status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null) }))`);
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

    let r = await api(nova, "GET", `${WEB}/api/runtime/model-applications/eligible-brands`, null, null);
    check("drafts.nova.eligible-brands", r.status === 200 && r.body?.count >= 1 && r.body.items.some((b) => b.brandId === NOVA_COOL), `status ${r.status}, count ${r.body?.count}`);

    r = await api(pixel, "GET", `${WEB}/api/runtime/model-applications/eligible-brands`, null, null);
    check("drafts.pixel.eligible-brands", r.status === 200 && r.body.items.some((b) => b.principalOrganisation === "NOVA"), `principal NOVA for agency`);

    const createBody = { brandId: NOVA_COOL, category: "RAC", modelNumber: "NC-DRAFT-NEW" };
    const k1 = key();
    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications`, createBody, k1);
    const createdId = r.body?.id;
    check("drafts.nova.create", r.status === 201 && r.body?.state === "draft" && r.body?.brandId === NOVA_COOL, `${r.status} ref ${r.body?.reference}`);

    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications`, createBody, k1);
    check("drafts.nova.create-replay", r.status === 201 && r.replay === "true" && r.body?.id === createdId, "Idempotency-Replayed, same id");

    r = await api(nova, "PATCH", `${WEB}/api/runtime/model-applications/${DRAFT1}`, { version: 0, category: "RAC", modelNumber: "NC-RAC-12D-EDIT" }, key());
    check("drafts.nova.edit-draft", r.status === 200 && r.body?.modelNumber === "NC-RAC-12D-EDIT" && r.body?.version === 1, `version ${r.body?.version}`);

    r = await api(nova, "PATCH", `${WEB}/api/runtime/model-applications/${DRAFT1}`, { version: 0, category: "RAC", modelNumber: "NC-STALE" }, key());
    check("drafts.nova.stale-version", r.status === 409 && r.body?.error === "version_conflict", r.body?.error);

    r = await api(nova, "PATCH", `${WEB}/api/runtime/model-applications/${PIXEL_APP}`, { version: 0, category: "RAC", modelNumber: "X" }, key());
    check("drafts.nova.cross-org-edit", r.status === 404 && r.body?.error === "not_found", "cross-org patch");

    r = await api(nova, "POST", `${WEB}/api/runtime/model-applications`, { brandId: "00000000-0000-4000-d000-000000009999", category: "RAC", modelNumber: "BAD" }, key());
    check("drafts.nova.wrong-brand", r.status === 403 && r.body?.error === "brand_not_permitted", r.body?.error);

    sql("UPDATE app.brand SET status = 'revoked' WHERE id = '" + NOVA_COOL + "'");
    try {
      r = await api(pixel, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: "AU-BAD" }, key());
      check("drafts.pixel.revoked-brand", r.status === 403 && r.body?.error === "brand_not_permitted", "revoked brand");
    } finally {
      sql("UPDATE app.brand SET status = 'active' WHERE id = '" + NOVA_COOL + "'");
    }

    sql("UPDATE app.agency_authorisation SET valid_from = '2020-01-01', valid_to = '2025-01-01' WHERE id = '00000000-0000-4000-e000-000000000001'");
    try {
      r = await api(pixel, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: "AU-EXP" }, key());
      check("drafts.pixel.expired-auth", r.status === 403 && r.body?.error === "brand_not_permitted", "expired authorisation");
    } finally {
      sql("UPDATE app.agency_authorisation SET valid_from = '2026-01-01', valid_to = NULL WHERE id = '00000000-0000-4000-e000-000000000001'");
    }

    r = await api(pixel, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: "AU-DRAFT-1" }, key());
    check("drafts.pixel.create", r.status === 201 && r.body?.principalOrganisation === "NOVA", `filing PIXEL principal ${r.body?.principalOrganisation}`);

    const legacy = sql("SELECT brand_id IS NULL FROM app.model_application WHERE reference = 'LOCAL-MA-0002'");
    check("drafts.legacy-rows-preserved", legacy === "t", "fee_due row still without brand_id link");

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
