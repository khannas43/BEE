/* eslint-disable */
/** WP06.1a: local test-report document intake via BFF; baseline-preserving, run twice. */
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { USERS } = require("../../local/generate-fixtures.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");
const contract = require("./contract-lib.cjs");
const doc = contract.load();

const RUNTIME_DOCS = "/api/runtime/model-applications/{id}/documents";
const RUNTIME_CONTENT = "/api/runtime/model-applications/{id}/documents/{documentId}/versions/{versionId}/content";
const NOVA_COOL = "00000000-0000-4000-d000-000000000001";
const PIXEL_APP = "00000000-0000-4000-c000-000000000003";
const key = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);

let pass = 0, fail = 0;
function check(id, ok, detail) { const r = ok ? "PASS" : "FAIL"; ok ? pass++ : fail++; console.log(`${r.padEnd(4)} ${id.padEnd(48)} ${detail}`); }

const env = (k, d) => process.env[k] || d;
const STORE = env("BEE_DOCUMENTS_STORE", path.join(__dirname, "../../.local/documents"));

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
function sqlRuntime(q, allowFail = false) {
  try {
    return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime")}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", env("BEE_RUNTIME_DB_USER", "bee_runtime"), "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
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
    sqlMaint(`SELECT set_config('bee.cleanup_schema', 'app', true); INSERT INTO app.local_disposable_application (application_id) VALUES ('${id}') ON CONFLICT DO NOTHING`);
  }
}

function cleanupDisposable(createdIds) {
  if (createdIds.length) {
    registerDisposable(createdIds);
    const arr = createdIds.map((id) => `'${id}'`).join(",");
    sqlMaint(`SELECT set_config('bee.cleanup_schema', 'app', true); SELECT app.app_disposable_model_cleanup(ARRAY[${arr}]::uuid[])`);
  }
  sqlApp(`DELETE FROM app.idempotency_record WHERE account_id IN (${twinAccountIds()})`);
}

function minPdf(label) {
  return Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<< /Info << /Title (${label}) >> >>\n%%EOF\n`);
}

function recordDocs(method, status, code, r, route = RUNTIME_DOCS) {
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({
    route, method, status, code: code ?? "-",
    ok: contract.conforms(doc, route, method, faux).length === 0,
  });
}

async function apiJson(page, method, path, body, idem) {
  const headers = { "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) };
  const bodySnippet = body == null ? "undefined" : `JSON.stringify(${JSON.stringify(body)})`;
  return page.eval(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "include", cache: "no-store", headers: ${JSON.stringify(headers)}, body: ${bodySnippet} }).then(async (r) => { const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; }); return { status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null), headers: hs }; })`);
}

async function apiUpload(page, appId, pdfBytes, label, idem, extra = {}) {
  const b64 = pdfBytes.toString("base64");
  return page.eval(`(async () => {
    const bin = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
    const file = new File([bin], ${JSON.stringify(extra.filename || "report.pdf")}, { type: "application/pdf" });
    const form = new FormData();
    ${extra.omitFile ? "" : 'form.append("file", file);'}
    form.append("documentKind", ${JSON.stringify(extra.documentKind || "test_report")});
    form.append("reportLabel", ${JSON.stringify(label)});
    ${extra.testedOn ? `form.append("testedOn", ${JSON.stringify(extra.testedOn)});` : ""}
    ${extra.laboratoryName ? `form.append("laboratoryName", ${JSON.stringify(extra.laboratoryName)});` : ""}
    const headers = ${idem ? `{ "Idempotency-Key": ${JSON.stringify(idem)} }` : "{}"};
    const r = await fetch(${JSON.stringify(`${WEB}/api/runtime/model-applications/`)} + ${JSON.stringify(appId)} + "/documents", { method: "POST", credentials: "include", cache: "no-store", headers, body: form });
    const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; });
    return { status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null), headers: hs };
  })()`);
}

async function apiRawMultipart(page, appId, idem, body) {
  return page.eval(`(async () => {
    const r = await fetch(${JSON.stringify(`${WEB}/api/runtime/model-applications/`)} + ${JSON.stringify(appId)} + "/documents", {
      method: "POST", credentials: "include", cache: "no-store",
      headers: { "Idempotency-Key": ${JSON.stringify(idem)}, "Content-Type": "multipart/form-data; boundary=zzzBoundary" },
      body: ${JSON.stringify(body)},
    });
    const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; });
    return { status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null), headers: hs };
  })()`);
}

async function apiList(page, appId) {
  return page.eval(`fetch(${JSON.stringify(`${WEB}/api/runtime/model-applications/${appId}/documents`)}, { credentials: "include", cache: "no-store" }).then(async (r) => { const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; }); return { status: r.status, body: await r.json().catch(() => null), headers: hs }; })`);
}

async function apiContent(page, appId, docId, verId) {
  const url = `${WEB}/api/runtime/model-applications/${appId}/documents/${docId}/versions/${verId}/content`;
  return page.eval(`fetch(${JSON.stringify(url)}, { credentials: "include", cache: "no-store" }).then(async (r) => {
    const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; });
    const buf = r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    let body = null;
    if (!r.ok) body = await r.json().catch(() => null);
    return { status: r.status, headers: hs, body, bytes: buf ? Array.from(buf) : null, contentType: r.headers.get("content-type") };
  })`);
}

async function runDocumentChecks(runLabel, nova, pixel) {
  const createdIds = [];
  const before = modelBaseline();
  const blobsBefore = new Set(fs.existsSync(STORE) ? fs.readdirSync(STORE).filter((f) => /^[0-9a-f]{64}$/.test(f)) : []);
  try {
    let r = await apiJson(nova, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: `NC-DOC-${runLabel}-${Date.now()}` }, key());
    if (r.body?.id) createdIds.push(r.body.id);
    const novaDraft = r.body?.id;
    check(`${runLabel}.nova.create-draft`, r.status === 201 && r.body?.state === "draft", r.body?.reference);

    const pdf1 = minPdf(`${runLabel}-v1`);
    const sha1 = crypto.createHash("sha256").update(pdf1).digest("hex");
    const upKey = key();
    r = await apiUpload(nova, novaDraft, pdf1, `Report ${runLabel}`, upKey, { laboratoryName: "Local Lab Demo" });
    recordDocs("POST", r.status, r.status >= 400 ? r.body?.error : "-", r);
    check(`${runLabel}.nova.upload`, r.status === 201 && r.body?.documentKind === "test_report" && r.body?.verificationStatus === "pending_local_verification" && r.body?.latestVersion?.contentSha256 === sha1, r.body?.latestVersion?.contentSha256?.slice(0, 12));
    check(`${runLabel}.nova.hash-on-disk`, fs.existsSync(path.join(STORE, sha1)) && fs.readFileSync(path.join(STORE, sha1)).equals(pdf1), "bytes match");

    r = await apiUpload(nova, novaDraft, pdf1, `Report ${runLabel}`, upKey, { laboratoryName: "Local Lab Demo" });
    recordDocs("POST", r.status, r.status >= 400 ? r.body?.error : "-", r);
    check(`${runLabel}.nova.upload-retry`, r.status === 201 && r.replay === "true" && r.body?.versions?.length === 1, `replay=${r.replay}`);

    const pdf2 = minPdf(`${runLabel}-v2`);
    const sha2 = crypto.createHash("sha256").update(pdf2).digest("hex");
    r = await apiUpload(nova, novaDraft, pdf2, `Report ${runLabel} v2`, key());
    recordDocs("POST", r.status, r.status >= 400 ? r.body?.error : "-", r);
    check(`${runLabel}.nova.version-2`, r.status === 201 && r.body?.versions?.length === 2 && r.body?.latestVersion?.versionNumber === 2 && r.body?.latestVersion?.contentSha256 === sha2, `versions=${r.body?.versions?.length}`);

    r = await apiList(nova, novaDraft);
    recordDocs("GET", r.status, r.status >= 400 ? r.body?.error : "-", r);
    check(`${runLabel}.nova.list`, r.status === 200 && r.body?.localStore === true && /pending verification/i.test(r.body?.verificationNote || "") && r.body?.count === 1, r.body?.verificationNote?.slice(0, 40));

    const docId = r.body.items[0].id;
    const ver1 = r.body.items[0].versions[0];
    const ver2 = r.body.items[0].versions[1];
    let c = await apiContent(nova, novaDraft, docId, ver1.id);
    const fauxContent = {
      status: c.status,
      json: c.body,
      text: c.body ? JSON.stringify(c.body) : "",
      headers: new Headers(Object.entries(c.headers || {}).map(([k, v]) => [k, v])),
    };
    contract.record({
      route: RUNTIME_CONTENT, method: "GET", status: c.status, code: c.status >= 400 ? c.body?.error ?? "-" : "-",
      ok: contract.conforms(doc, RUNTIME_CONTENT, "GET", fauxContent).length === 0,
    });
    check(`${runLabel}.nova.content-v1`, c.status === 200 && c.contentType?.startsWith("application/pdf") && Buffer.from(c.bytes).equals(pdf1), `status=${c.status}`);

    c = await apiContent(nova, novaDraft, docId, ver2.id);
    check(`${runLabel}.nova.content-v2`, c.status === 200 && Buffer.from(c.bytes).equals(pdf2), `bytes=${c.bytes?.length}`);

    r = await apiUpload(nova, novaDraft, Buffer.from("not-a-pdf"), "Bad", key(), { filename: "bad.pdf" });
    recordDocs("POST", r.status, r.body?.error, r);
    check(`${runLabel}.nova.invalid-pdf`, r.status === 422 && r.body?.error === "validation_failed", r.body?.error);

    const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(Number(env("BEE_DOCUMENTS_MAX_BYTES", "5242880")) + 100, 0x41)]);
    r = await apiUpload(nova, novaDraft, big, "Huge", key());
    recordDocs("POST", r.status, r.body?.error, r);
    check(`${runLabel}.nova.oversized`, r.status === 422 && r.body?.error === "validation_failed", r.body?.error);

    // Review fixes: a file exactly at the limit must pass real Tomcat multipart parsing (request overhead included).
    const maxBytes = Number(env("BEE_DOCUMENTS_MAX_BYTES", "5242880"));
    const head = Buffer.from("%PDF-1.4\n");
    const atLimit = Buffer.concat([head, Buffer.alloc(maxBytes - head.length, 0x42)]);
    r = await apiUpload(nova, novaDraft, atLimit, "At the limit", key());
    recordDocs("POST", r.status, r.status >= 400 ? r.body?.error : "-", r);
    check(`${runLabel}.nova.exact-limit-accepted`, r.status === 201 && r.body?.latestVersion?.sizeBytes === maxBytes, `status=${r.status} ${r.body?.error ?? ""}`);

    // A real-world filename is kept as the display name, not rejected; the download header stays ASCII.
    const friendly = "Test Report (1) \u092a\u094d\u0930\u0924\u093f\u0935\u0947\u0926\u0928.pdf";
    r = await apiUpload(nova, novaDraft, minPdf(`friendly-${runLabel}`), "Friendly name", key(), { filename: friendly });
    recordDocs("POST", r.status, r.status >= 400 ? r.body?.error : "-", r);
    check(`${runLabel}.nova.friendly-filename`, r.status === 201 && r.body?.latestVersion?.originalFilename === friendly, r.body?.latestVersion?.originalFilename ?? r.body?.error);
    if (r.status === 201) {
      c = await apiContent(nova, novaDraft, docId, r.body.latestVersion.id);
      const disp = c.headers?.["content-disposition"] ?? "";
      check(`${runLabel}.nova.friendly-filename-download`, c.status === 200 && /^attachment; filename="[A-Za-z0-9._ -]{1,180}"$/.test(disp), disp.slice(0, 60));
    }

    // A missing required part is the contract's 422, never a 500.
    r = await apiUpload(nova, novaDraft, minPdf("nofile"), "No file", key(), { omitFile: true });
    recordDocs("POST", r.status, r.body?.error, r);
    check(`${runLabel}.nova.missing-file-part`, r.status === 422 && r.body?.error === "validation_failed", `status=${r.status} ${r.body?.error ?? ""}`);

    r = await apiList(pixel, novaDraft);
    recordDocs("GET", r.status, r.body?.error, r);
    check(`${runLabel}.pixel.cross-org-list`, r.status === 404 && r.body?.error === "not_found", r.body?.error);
    c = await apiContent(pixel, novaDraft, docId, ver2.id);
    check(`${runLabel}.pixel.cross-org-content`, c.status === 404 && c.body?.error === "not_found", c.body?.error);
    r = await apiUpload(pixel, novaDraft, pdf1, "X", key());
    recordDocs("POST", r.status, r.body?.error, r);
    check(`${runLabel}.pixel.cross-org-upload`, r.status === 404 && r.body?.error === "not_found", r.body?.error);
    // Authorisation precedes payload validation: another organisation with a bad payload still sees 404.
    r = await apiUpload(pixel, novaDraft, pdf1, "X", key(), { omitFile: true });
    recordDocs("POST", r.status, r.body?.error, r);
    check(`${runLabel}.pixel.cross-org-invalid-payload`, r.status === 404 && r.body?.error === "not_found", `status=${r.status} ${r.body?.error ?? ""}`);

    // A malformed multipart body is the contract's 422, never a 500.
    r = await apiRawMultipart(nova, novaDraft, key(), "this is not a multipart body");
    recordDocs("POST", r.status, r.body?.error, r);
    check(`${runLabel}.nova.malformed-multipart`, r.status === 422 && r.body?.error === "validation_failed", `status=${r.status} ${r.body?.error ?? ""}`);

    r = await apiList(nova, "00000000-0000-4000-c000-000000009999");
    recordDocs("GET", r.status, r.body?.error, r);
    check(`${runLabel}.nova.unknown-id`, r.status === 404 && r.body?.error === "not_found", "same as cross-org");

    r = await apiJson(pixel, "POST", `${WEB}/api/runtime/model-applications`, { brandId: NOVA_COOL, category: "RAC", modelNumber: `AU-DOC-${runLabel}-${Date.now()}` }, key());
    if (r.body?.id) createdIds.push(r.body.id);
    const agencyDraft = r.body?.id;
    r = await apiUpload(pixel, agencyDraft, minPdf(`agency-${runLabel}`), "Agency report", key());
    recordDocs("POST", r.status, r.status >= 400 ? r.body?.error : "-", r);
    check(`${runLabel}.pixel.agency-upload`, r.status === 201, r.body?.latestVersion?.versionNumber);

    sql("UPDATE app.brand SET status = 'revoked' WHERE id = '" + NOVA_COOL + "'");
    try {
      r = await apiUpload(nova, novaDraft, minPdf("revoked"), "After revoke", key());
      recordDocs("POST", r.status, r.body?.error, r);
      check(`${runLabel}.nova.revoked-brand`, r.status === 403 && r.body?.error === "brand_not_permitted", r.body?.error);
    } finally {
      sql("UPDATE app.brand SET status = 'active' WHERE id = '" + NOVA_COOL + "'");
    }

    const delDeny = sqlRuntime(`DELETE FROM app.model_application_document_version WHERE document_id = '${docId}'`, true);
    check(`${runLabel}.runtime-no-version-delete`, /append-only|55000|permission denied/i.test(delDeny), delDeny.slice(0, 72));

    await nova.goto(`${WEB}/app/model-label/new-model-application?edit=${encodeURIComponent(novaDraft)}`);
    const ui = await nova.waitFor(`!!document.querySelector('[data-testid=model-doc-upload]')`, 12000);
    const note = await nova.eval(`document.querySelector('[data-testid=model-doc-verification-note]')?.textContent || ""`);
    check(`${runLabel}.ui.intake-on-form`, ui && /pending verification/i.test(note), note.slice(0, 48));

  } finally {
    cleanupDisposable(createdIds);
    const after = modelBaseline();
    check(`${runLabel}.baseline-preserved`, before === after, before === after ? "seed rows unchanged" : "drift");
    const blobsAfter = fs.existsSync(STORE) ? fs.readdirSync(STORE).filter((f) => /^[0-9a-f]{64}$/.test(f)) : [];
    for (const f of blobsAfter) {
      if (!blobsBefore.has(f)) {
        try { fs.unlinkSync(path.join(STORE, f)); } catch { /* ignore */ }
      }
    }
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
    await runDocumentChecks("docs.run1", nova, pixel);
    await runDocumentChecks("docs.run2", nova, pixel);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("docs.run", false, String(e.message)))
  .then(() => {
    console.log(`model-documents checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
