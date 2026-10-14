/* eslint-disable */
/**
 * Brand and agency registration (WP04.2b-1), through the portal API with real roles. A manufacturer files, edits and submits a brand
 * request with a trade-licence PDF; an agency asks to act for a manufacturer's brand; Finance confirms the fee; nobody else reads or
 * writes; the fee is the REG rule's; nothing reaches the brand or authorisation tables (approval is WP04.2b-2). Each answer is checked
 * against the contract and recorded as live evidence. Runs twice; every row it makes is removed.
 */
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");

const contract = require("./contract-lib.cjs");
const doc = contract.load();

const env = (k, d) => process.env[k] || d;
const key = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
let pass = 0, fail = 0;
function check(id, ok, detail) { const r = ok ? "PASS" : "FAIL"; ok ? pass++ : fail++; console.log(`${r.padEnd(4)} ${id.padEnd(54)} ${detail}`); }

function psql(user, pw, q) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${pw}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", user, "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
}
const sqlApp = (q) => psql("bee_app", env("BEE_APP_DB_PASSWORD", "bee-local-app"), q);
const sqlMaint = (q) => psql(env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint"), q);

const NOVA_ORG = "00000000-0000-4000-b000-000000000001";
const R = "/api/runtime/registrations";
const routeOf = (path) => {
  const p = path.replace(WEB, "").split("?")[0];
  if (p === R) return R;
  if (p === `${R}/eligible-brands`) return `${R}/eligible-brands`;
  if (/\/documents\/[^/]+\/versions\/[^/]+\/content$/.test(p)) return `${R}/{id}/documents/{documentId}/versions/{versionId}/content`;
  if (/\/documents$/.test(p)) return `${R}/{id}/documents`;
  if (/\/submit$/.test(p)) return `${R}/{id}/submit`;
  if (/\/fee-confirmation$/.test(p)) return `${R}/{id}/fee-confirmation`;
  return `${R}/{id}`;
};

function record(method, path, r) {
  const route = routeOf(path);
  const faux = r.fauxOverride ?? contract.observationFromBrowserFetch(r);
  contract.record({ route, method, status: r.status, code: r.status >= 400 ? (r.body?.error ?? "-") : "-", ok: contract.conforms(doc, route, method, faux).length === 0 });
}

/** A JSON request through the browser's session. */
async function api(page, method, path, body, idem) {
  const headers = { "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) };
  const bodySnippet = body == null ? "undefined" : `JSON.stringify(${JSON.stringify(body)})`;
  const r = await page.eval(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "include", cache: "no-store", headers: ${JSON.stringify(headers)}, body: ${bodySnippet} }).then(async (r) => { const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; }); return { status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null), headers: hs }; })`);
  record(method, path, r);
  return r;
}

/** The trade-licence upload: a multipart form with the PDF (and optionally a label). */
async function upload(page, id, bytes, idem, extra = {}) {
  const path = `${WEB}${R}/${id}/documents`;
  const r = await page.eval(`(async () => {
    const bin = Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}), (c) => c.charCodeAt(0));
    const form = new FormData();
    ${extra.omitFile ? "" : `form.append("file", new File([bin], ${JSON.stringify(extra.filename || "licence.pdf")}, { type: "application/pdf" }));`}
    ${extra.label ? `form.append("label", ${JSON.stringify(extra.label)});` : ""}
    const r = await fetch(${JSON.stringify(path)}, { method: "POST", credentials: "include", cache: "no-store", headers: ${idem ? `{ "Idempotency-Key": ${JSON.stringify(idem)} }` : "{}"}, body: form });
    const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; });
    return { status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null), headers: hs };
  })()`);
  record("POST", path, r);
  return r;
}

/** The stored PDF, as an attachment. */
async function content(page, id, docId, verId) {
  const path = `${WEB}${R}/${id}/documents/${docId}/versions/${verId}/content`;
  const c = await page.eval(`fetch(${JSON.stringify(path)}, { credentials: "include", cache: "no-store" }).then(async (r) => {
    const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; });
    const buf = r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    const body = r.ok ? null : await r.json().catch(() => null);
    return { status: r.status, headers: hs, body, bytes: buf ? Array.from(buf) : null, contentType: r.headers.get("content-type") };
  })`);
  record("GET", path, c);
  return c;
}

/** Calls with no session: the portal answers 401 no_session, whatever the route. */
async function anonymous(method, path, body) {
  const headers = { Origin: WEB, "X-Correlation-Id": `live-reg-anon-${crypto.randomUUID().slice(0, 8)}` };
  let payload = body === undefined ? undefined : JSON.stringify(body);
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "POST" && path.endsWith("/documents")) {
    const boundary = "bee-registration-anon";
    payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\r\n--${boundary}--\r\n`;
    headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
  }
  if (method === "POST" || method === "PATCH") headers["Idempotency-Key"] = key();
  const res = await fetch(`${WEB}${path}`, { method, headers, body: payload, redirect: "manual" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const faux = { status: res.status, json, text, headers: res.headers };
  const route = routeOf(path);
  contract.record({ route, method, status: res.status, code: res.status >= 400 ? (json?.error ?? "-") : "-", ok: contract.conforms(doc, route, method, faux).length === 0 });
  return { status: res.status, body: json };
}

const minPdf = (label) => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<< /Info << /Title (${label}) >> >>\n%%EOF\n`);
const today = () => sqlApp(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text`);
const plusDays = (d, n) => sqlApp(`SELECT (DATE '${d}' + ${n})::text`);
const counts = () => sqlApp(`SELECT (SELECT count(*) FROM app.brand) || '|' || (SELECT count(*) FROM app.agency_authorisation) || '|' || (SELECT count(*) FROM app.model_application)`);

function cleanup(refs, twinIds, probeBrand) {
  if (refs.length) {
    const apps = `SELECT id FROM app.registration_application WHERE reference IN (${refs.map((x) => `'${x}'`).join(",")})`;
    sqlMaint(`DELETE FROM app.registration_fee_confirmation WHERE application_id IN (${apps});
      DELETE FROM app.registration_transition_event WHERE application_id IN (${apps});
      DELETE FROM app.registration_fee_snapshot WHERE application_id IN (${apps});
      DELETE FROM app.registration_submission_event WHERE application_id IN (${apps});
      DELETE FROM app.registration_document_version WHERE document_id IN (SELECT id FROM app.registration_document WHERE application_id IN (${apps}));
      DELETE FROM app.registration_document WHERE application_id IN (${apps});
      DELETE FROM app.registration_application WHERE id IN (${apps})`);
  }
  if (probeBrand) sqlApp(`DELETE FROM app.brand WHERE id = '${probeBrand}'`);
  sqlApp(`DELETE FROM app.idempotency_record WHERE account_id IN (${twinIds})`);
}

async function runChecks(run, P) {
  const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const PERSONA = ["nova.applicant", "pixel.applicant", "bee.finance", "bee.programme", "bee.admin"];
  const twinIds = PERSONA.map((u) => `'${ids.accountId(u)}'`).join(",");
  const before = counts();
  const refs = [];
  let probeBrand = null;
  const brandName = `Live ${tag}`;
  try {
    // 0. No session: every registration route answers 401 no_session.
    const anonOps = [["GET", R], ["POST", R, {}], ["GET", `${R}/eligible-brands`], ["GET", `${R}/${NOVA_ORG}`], ["PATCH", `${R}/${NOVA_ORG}`, {}], ["GET", `${R}/${NOVA_ORG}/submit`],
      ["POST", `${R}/${NOVA_ORG}/submit`, {}], ["POST", `${R}/${NOVA_ORG}/fee-confirmation`, {}], ["GET", `${R}/${NOVA_ORG}/documents`],
      ["POST", `${R}/${NOVA_ORG}/documents`, {}], ["GET", `${R}/${NOVA_ORG}/documents/${NOVA_ORG}/versions/${NOVA_ORG}/content`]];
    for (const [m, p, b] of anonOps) {
      const a = await anonymous(m, p, b);
      check(`${run}.anonymous.${m}-${routeOf(p).replace(R, "").replace(/[{}\/]+/g, "-") || "list"}`, a.status === 401 && a.body?.error === "no_session", `${a.status} ${a.body?.error}`);
    }

    // 1. A manufacturer names a new brand; an administrator reads nothing here.
    let r = await api(P.nova, "GET", `${WEB}${R}/eligible-brands`, null, null);
    check(`${run}.nova.brands-empty-for-a-manufacturer`, r.status === 200 && r.body?.count === 0, `${r.status} ${r.body?.count}`);
    r = await api(P.admin, "GET", `${WEB}${R}`, null, null);
    check(`${run}.admin.reads-nothing`, r.status === 403 && r.body?.error === "no_read_scope", `${r.status} ${r.body?.error}`);
    r = await api(P.admin, "POST", `${WEB}${R}`, { brandName }, key());
    check(`${run}.admin.cannot-file`, r.status === 403 && r.body?.error === "no_write_scope", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "POST", `${WEB}${R}`, { brandName }, null);
    check(`${run}.nova.key-required`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error}`);
    for (const [label, b] of [["empty", {}], ["blank-name", { brandName: "  " }], ["bad-characters", { brandName: "Bad<script>" }], ["agency-fields", { brandName, validFrom: "2030-01-01" }]]) {
      r = await api(P.nova, "POST", `${WEB}${R}`, b, key());
      check(`${run}.nova.refuses-${label}`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    }
    r = await api(P.nova, "POST", `${WEB}${R}`, { brandName: "Nova Cool" }, key());
    check(`${run}.nova.name-on-the-register-refused`, r.status === 409 && r.body?.error === "brand_name_taken", `${r.status} ${r.body?.error}`);

    const k1 = key();
    r = await api(P.nova, "POST", `${WEB}${R}`, { brandName }, k1);
    const reg = r.body;
    if (reg?.reference) refs.push(reg.reference);
    check(`${run}.nova.create-201`, r.status === 201 && reg?.state === "draft" && reg?.kind === "brand" && reg?.version === 0 && reg?.tradeLicenceUploaded === false && /^REG-\d{4}-\d+$/.test(reg?.reference ?? ""), `${reg?.reference} ${reg?.state}`);
    const again = await api(P.nova, "POST", `${WEB}${R}`, { brandName }, k1);
    check(`${run}.nova.replay-is-the-same-request`, again.status === 201 && again.replay === "true" && again.body?.id === reg?.id, `${again.status} replay=${again.replay}`);
    r = await api(P.nova, "POST", `${WEB}${R}`, { brandName: `${brandName} X` }, k1);
    check(`${run}.nova.key-reuse-with-other-body-conflicts`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "POST", `${WEB}${R}`, { brandName: brandName.toLowerCase() }, key());
    check(`${run}.nova.same-name-again-is-a-duplicate`, r.status === 409 && r.body?.error === "duplicate_registration", `${r.status} ${r.body?.error}`);

    // 2. Edit; a stale version conflicts; others cannot see or edit it.
    const id = reg.id;
    const renamed = `${brandName} Air`;
    r = await api(P.nova, "PATCH", `${WEB}${R}/${id}`, { version: 0, brandName: renamed }, key());
    check(`${run}.nova.patch-200`, r.status === 200 && r.body?.brandName === renamed && r.body?.version === 1, `${r.status} v${r.body?.version}`);
    r = await api(P.nova, "PATCH", `${WEB}${R}/${id}`, { version: 0, brandName: `${brandName} Old` }, key());
    check(`${run}.nova.stale-version-conflicts`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "PATCH", `${WEB}${R}/${id}`, { version: 1 }, key());
    check(`${run}.nova.patch-needs-a-name`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await api(P.pixel, "GET", `${WEB}${R}/${id}`, null, null);
    check(`${run}.pixel.cannot-read-anothers`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await api(P.pixel, "PATCH", `${WEB}${R}/${id}`, { version: 1, brandId: "00000000-0000-4000-d000-000000000001" }, key());
    check(`${run}.pixel.cannot-edit-anothers`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "GET", `${WEB}${R}/${id}`, null, null);
    check(`${run}.finance.cannot-read-a-draft`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "GET", `${WEB}${R}`, null, null);
    check(`${run}.nova.list-shows-it`, r.status === 200 && r.body?.items?.some((x) => x.id === id && x.brandName === renamed), `${r.status} ${r.body?.count}`);

    // 3. The trade licence gates the submit.
    r = await api(P.nova, "GET", `${WEB}${R}/${id}/submit`, null, null);
    check(`${run}.nova.preview-not-ready-without-a-licence`, r.status === 200 && r.body?.ready === false && r.body?.gates?.some((g) => g.code === "trade_licence_uploaded" && g.met === false), `${r.status} ready=${r.body?.ready}`);
    const fee = r.body?.submissionFee;
    check(`${run}.nova.preview-fee-is-the-reg-rule`, fee?.feeRuleKey === "REG:brand_registration" && fee?.localDemoFee === true && /^\d+\.\d{2}$/.test(fee?.totalInr ?? ""), `${fee?.feeRuleKey} ${fee?.totalInr}`);
    const submitBody = (version, f = fee) => ({ version, expectedFee: { amountInr: f.amountInr, feeRuleKey: f.feeRuleKey, feeRuleVersion: f.feeRuleVersion } });
    r = await api(P.nova, "POST", `${WEB}${R}/${id}/submit`, submitBody(1), key());
    check(`${run}.nova.submit-needs-the-licence`, r.status === 422 && r.body?.error === "document_required", `${r.status} ${r.body?.error}`);
    const pdf1 = minPdf(`${run}-v1`);
    r = await upload(P.nova, id, Buffer.from("not-a-pdf"), key());
    check(`${run}.nova.upload-refuses-a-non-pdf`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await upload(P.nova, id, pdf1, key(), { omitFile: true });
    check(`${run}.nova.upload-needs-a-file`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await upload(P.nova, id, pdf1, null);
    check(`${run}.nova.upload-needs-a-key`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error}`);
    r = await upload(P.pixel, id, pdf1, key());
    check(`${run}.pixel.cannot-upload-to-anothers`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    const ku = key();
    r = await upload(P.nova, id, pdf1, ku);
    check(`${run}.nova.upload-201`, r.status === 201 && r.body?.documentKind === "trade_licence" && r.body?.verificationStatus === "pending_local_verification" && r.body?.latestVersion?.versionNumber === 1 && r.body?.latestVersion?.label === "Trade licence", `${r.status} v${r.body?.latestVersion?.versionNumber}`);
    const sha1 = crypto.createHash("sha256").update(pdf1).digest("hex");
    check(`${run}.nova.upload-stores-the-exact-bytes`, r.body?.latestVersion?.contentSha256 === sha1, r.body?.latestVersion?.contentSha256?.slice(0, 12));
    const rep = await upload(P.nova, id, pdf1, ku);
    check(`${run}.nova.upload-replay`, rep.status === 201 && rep.replay === "true" && rep.body?.versions?.length === 1, `replay=${rep.replay}`);
    const pdf2 = minPdf(`${run}-v2`);
    r = await upload(P.nova, id, pdf2, key(), { label: "Renewed licence" });
    check(`${run}.nova.second-upload-is-version-2`, r.status === 201 && r.body?.versions?.length === 2 && r.body?.latestVersion?.label === "Renewed licence", `${r.status} ${r.body?.versions?.length}`);
    r = await api(P.nova, "GET", `${WEB}${R}/${id}/documents`, null, null);
    const docId = r.body?.items?.[0]?.id, ver1 = r.body?.items?.[0]?.versions?.[0], ver2 = r.body?.items?.[0]?.versions?.[1];
    check(`${run}.nova.documents-list`, r.status === 200 && r.body?.count === 1 && !!docId && !!ver1 && !!ver2, `${r.status} ${r.body?.count}`);
    let c = await content(P.nova, id, docId, ver1.id);
    check(`${run}.nova.content-v1-is-the-uploaded-file`, c.status === 200 && c.contentType?.startsWith("application/pdf") && Buffer.from(c.bytes).equals(pdf1), `status=${c.status}`);
    c = await content(P.nova, id, docId, ver2.id);
    check(`${run}.nova.content-v2-is-the-renewed-file`, c.status === 200 && Buffer.from(c.bytes).equals(pdf2), `bytes=${c.bytes?.length}`);
    c = await content(P.pixel, id, docId, ver1.id);
    check(`${run}.pixel.cannot-download-anothers`, c.status === 404 && c.body?.error === "not_found", `${c.status} ${c.body?.error}`);
    c = await content(P.nova, id, docId, crypto.randomUUID());
    check(`${run}.nova.unknown-version-404`, c.status === 404 && c.body?.error === "not_found", `${c.status} ${c.body?.error}`);
    r = await api(P.pixel, "GET", `${WEB}${R}/${id}/documents`, null, null);
    check(`${run}.pixel.cannot-list-anothers`, r.status === 404, `${r.status}`);

    // 4. Submit: the fee is the rule's, shown before and kept after.
    r = await api(P.nova, "GET", `${WEB}${R}/${id}/submit`, null, null);
    check(`${run}.nova.preview-ready-with-a-licence`, r.status === 200 && r.body?.ready === true && r.body?.gates?.every((g) => g.met), `${r.status} ready=${r.body?.ready}`);
    r = await api(P.nova, "POST", `${WEB}${R}/${id}/submit`, submitBody(1, { ...fee, amountInr: "1.00" }), key());
    check(`${run}.nova.changed-fee-conflicts`, r.status === 409 && r.body?.error === "fee_preview_conflict", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "POST", `${WEB}${R}/${id}/submit`, submitBody(0), key());
    check(`${run}.nova.stale-submit-conflicts`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error}`);
    r = await api(P.pixel, "POST", `${WEB}${R}/${id}/submit`, submitBody(1), key());
    check(`${run}.pixel.cannot-submit-anothers`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "POST", `${WEB}${R}/${id}/submit`, {}, key());
    check(`${run}.nova.submit-body-checked`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    const ks = key();
    r = await api(P.nova, "POST", `${WEB}${R}/${id}/submit`, submitBody(1), ks);
    check(`${run}.nova.submit-200-fee-due`, r.status === 200 && r.body?.state === "fee_due" && r.body?.version === 2 && r.body?.submissionFee?.feeRuleKey === "REG:brand_registration" && r.body?.submissionFee?.totalInr === fee.totalInr, `${r.status} ${r.body?.state} ${r.body?.submissionFee?.totalInr}`);
    r = await api(P.nova, "POST", `${WEB}${R}/${id}/submit`, submitBody(1), ks);
    check(`${run}.nova.submit-replay`, r.status === 200 && r.replay === "true" && r.body?.state === "fee_due", `replay=${r.replay}`);
    r = await api(P.nova, "POST", `${WEB}${R}/${id}/submit`, submitBody(2), key());
    check(`${run}.nova.cannot-submit-twice`, r.status === 403 && r.body?.error === "not_submittable", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "GET", `${WEB}${R}/${id}/submit`, null, null);
    check(`${run}.nova.preview-closed-after-submit`, r.status === 403 && r.body?.error === "not_submittable", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "PATCH", `${WEB}${R}/${id}`, { version: 2, brandName: `${brandName} Late` }, key());
    check(`${run}.nova.cannot-edit-after-submit`, r.status === 403 && r.body?.error === "not_editable", `${r.status} ${r.body?.error}`);
    r = await upload(P.nova, id, pdf1, key());
    check(`${run}.nova.cannot-upload-after-submit`, r.status === 403 && r.body?.error === "not_editable", `${r.status} ${r.body?.error}`);
    check(`${run}.db.one-submission-event-and-one-snapshot`, sqlApp(`SELECT (SELECT count(*) FROM app.registration_submission_event e JOIN app.registration_application a ON a.id = e.application_id WHERE a.id = '${id}') || '|' || (SELECT count(*) FROM app.registration_fee_snapshot s WHERE s.application_id = '${id}')`) === "1|1", "1|1");

    // 5. Finance confirms the fee; only Finance, only the right amount, only once.
    r = await api(P.finance, "GET", `${WEB}${R}/${id}`, null, null);
    check(`${run}.finance.reads-a-fee-due-request`, r.status === 200 && r.body?.state === "fee_due", `${r.status} ${r.body?.state}`);
    r = await api(P.finance, "GET", `${WEB}${R}`, null, null);
    check(`${run}.finance.list-holds-only-fee-due`, r.status === 200 && r.body?.items?.every((x) => x.state === "fee_due") && r.body.items.some((x) => x.id === id), `${r.status} ${r.body?.count}`);
    r = await api(P.finance, "GET", `${WEB}${R}/${id}/documents`, null, null);
    check(`${run}.finance.reads-the-licence`, r.status === 200 && r.body?.count === 1, `${r.status}`);
    const feeBody = (version, amount, extra = {}) => ({ version, receiptReference: `RCPT-${tag}`, receivedOn: "2026-10-01", amountInr: amount, ...extra });
    r = await api(P.nova, "POST", `${WEB}${R}/${id}/fee-confirmation`, feeBody(2, fee.totalInr), key());
    check(`${run}.nova.cannot-confirm-their-own-fee`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "POST", `${WEB}${R}/${id}/fee-confirmation`, feeBody(2, "1.00"), key());
    check(`${run}.finance.wrong-amount-refused`, r.status === 422 && r.body?.error === "amount_mismatch", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "POST", `${WEB}${R}/${id}/fee-confirmation`, feeBody(2, fee.totalInr, { receivedOn: "2999-01-01" }), key());
    check(`${run}.finance.future-date-refused`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "POST", `${WEB}${R}/${id}/fee-confirmation`, feeBody(1, fee.totalInr), key());
    check(`${run}.finance.stale-version-conflicts`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "POST", `${WEB}${R}/${id}/fee-confirmation`, feeBody(2, fee.totalInr), null);
    check(`${run}.finance.key-required`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error}`);
    const kf = key();
    r = await api(P.finance, "POST", `${WEB}${R}/${id}/fee-confirmation`, feeBody(2, fee.totalInr), kf);
    check(`${run}.finance.confirm-200`, r.status === 200 && r.body?.fromState === "fee_due" && r.body?.toState === "programme_review" && r.body?.version === 3 && r.body?.receiptReference === `RCPT-${tag}`, `${r.status} ${r.body?.toState}`);
    r = await api(P.finance, "POST", `${WEB}${R}/${id}/fee-confirmation`, feeBody(2, fee.totalInr), kf);
    check(`${run}.finance.confirm-replay`, r.status === 200 && r.replay === "true", `replay=${r.replay}`);
    r = await api(P.finance, "POST", `${WEB}${R}/${id}/fee-confirmation`, feeBody(2, fee.totalInr, { receiptReference: "OTHER" }), kf);
    check(`${run}.finance.key-reuse-with-other-body-conflicts`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "POST", `${WEB}${R}/${id}/fee-confirmation`, feeBody(3, fee.totalInr), key());
    check(`${run}.finance.cannot-confirm-twice`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "GET", `${WEB}${R}/${id}`, null, null);
    check(`${run}.finance.no-longer-reads-it`, r.status === 404, `${r.status}`);
    r = await api(P.programme, "GET", `${WEB}${R}/${id}`, null, null);
    check(`${run}.programme.reads-the-review-stage`, r.status === 200 && r.body?.state === "programme_review", `${r.status} ${r.body?.state}`);
    r = await api(P.nova, "GET", `${WEB}${R}/${id}`, null, null);
    check(`${run}.nova.sees-it-in-review`, r.status === 200 && r.body?.state === "programme_review" && r.body?.version === 3, `${r.status} ${r.body?.state}`);
    check(`${run}.db.confirmation-and-event-recorded`, sqlApp(`SELECT (SELECT count(*) FROM app.registration_fee_confirmation WHERE application_id = '${id}') || '|' || (SELECT count(*) FROM app.registration_transition_event WHERE application_id = '${id}' AND action = 'confirm_fee' AND actor_account_id = '${ids.accountId("bee.finance")}')`) === "1|1", "1|1");

    // 6. An agency asks to act for a manufacturer's brand.
    probeBrand = sqlApp(`INSERT INTO app.brand (name, owner_organisation_id, status, source_reference, verification_status, note) VALUES ('Probe ${tag}', '${NOVA_ORG}', 'active', 'live check', 'synthetic', 'probe') RETURNING id`).split("\n")[0];
    r = await api(P.pixel, "GET", `${WEB}${R}/eligible-brands`, null, null);
    check(`${run}.pixel.brands-lists-active-brands`, r.status === 200 && r.body?.items?.some((b) => b.brandId === probeBrand && b.principalOrganisation === "NOVA"), `${r.status} ${r.body?.count}`);
    r = await api(P.nova, "POST", `${WEB}${R}`, { brandId: probeBrand }, key());
    check(`${run}.nova.manufacturer-cannot-file-an-agency-request`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await api(P.pixel, "POST", `${WEB}${R}`, { brandId: crypto.randomUUID() }, key());
    check(`${run}.pixel.unknown-brand-refused`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await api(P.pixel, "POST", `${WEB}${R}`, { brandName: "Own Brand" }, key());
    check(`${run}.pixel.agency-cannot-name-a-new-brand`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    const t = await today();
    const from = await plusDays(t, 1);
    r = await api(P.pixel, "POST", `${WEB}${R}`, { brandId: probeBrand, validFrom: from, validTo: await plusDays(t, 400) }, key());
    const areg = r.body;
    if (areg?.reference) refs.push(areg.reference);
    check(`${run}.pixel.agency-create-201`, r.status === 201 && areg?.kind === "agency" && areg?.brandName === `Probe ${tag}` && areg?.brandId === probeBrand && areg?.validFrom === from, `${r.status} ${areg?.reference}`);
    r = await api(P.pixel, "POST", `${WEB}${R}`, { brandId: probeBrand }, key());
    check(`${run}.pixel.same-brand-again-is-a-duplicate`, r.status === 409 && r.body?.error === "duplicate_registration", `${r.status} ${r.body?.error}`);
    r = await api(P.pixel, "POST", `${WEB}${R}`, { brandId: probeBrand, validTo: await plusDays(t, 5) }, key());
    check(`${run}.pixel.end-without-a-start-refused`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await upload(P.pixel, areg.id, minPdf(`${run}-agency`), key(), { label: "Agency licence" });
    check(`${run}.pixel.agency-upload-201`, r.status === 201 && r.body?.latestVersion?.label === "Agency licence", `${r.status}`);
    r = await api(P.pixel, "GET", `${WEB}${R}/${areg.id}/submit`, null, null);
    const afee = r.body?.submissionFee;
    check(`${run}.pixel.agency-preview-uses-the-agency-rule`, r.status === 200 && r.body?.ready === true && afee?.feeRuleKey === "REG:agency_registration", `${r.status} ${afee?.feeRuleKey} ${afee?.totalInr}`);
    r = await api(P.pixel, "POST", `${WEB}${R}/${areg.id}/submit`, { version: areg.version, expectedFee: { amountInr: afee.amountInr, feeRuleKey: afee.feeRuleKey, feeRuleVersion: afee.feeRuleVersion } }, key());
    check(`${run}.pixel.agency-submit-200`, r.status === 200 && r.body?.state === "fee_due" && r.body?.submissionFee?.feeRuleKey === "REG:agency_registration", `${r.status} ${r.body?.state}`);
    r = await api(P.finance, "POST", `${WEB}${R}/${areg.id}/fee-confirmation`, { version: areg.version + 1, receiptReference: `RCPT-A-${tag}`, receivedOn: "2026-10-01", amountInr: afee.totalInr }, key());
    check(`${run}.finance.agency-confirm-200`, r.status === 200 && r.body?.toState === "programme_review", `${r.status} ${r.body?.toState}`);

    // 7. Nothing here touches the register or the model applications: approval is WP04.2b-2.
    check(`${run}.db.brands-authorisations-applications-unchanged`, counts().replace(/^(\d+)\|/, (m, n) => `${Number(n) - 1}|`) === before, counts());
  } finally {
    cleanup(refs, twinIds, probeBrand);
  }
  check(`${run}.db.cleaned-up`, counts() === before, counts());
}

async function main() {
  const chrome = await launchChrome();
  try {
    const who = { nova: ids.name("nova.applicant"), pixel: ids.name("pixel.applicant"), finance: ids.name("bee.finance"), programme: ids.name("bee.programme"), admin: ids.name("bee.admin") };
    const P = {};
    for (const [k, u] of Object.entries(who)) {
      await totp.ensureEnrolled(u);
      P[k] = await openPage(chrome.cdp);
      if (!(await signIn(P[k], u))) throw new Error(`${k} sign-in failed`);
    }
    await runChecks("registration.run1", P);
    await runChecks("registration.run2", P);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("registration.run", false, String(e.message)))
  .then(() => {
    console.log(`registration checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
