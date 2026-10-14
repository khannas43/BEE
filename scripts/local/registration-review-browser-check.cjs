/* eslint-disable */
/**
 * Review and approval of a registration (WP04.2b-2), through the portal API with real roles. Programme recommends, the Director approves
 * and the brand (or the agency authorisation) appears on the register; a returned request is edited and resubmitted; the Director can
 * reject; the wrong role, the wrong state and a stale version are refused; the applicant sees the decision and its reason. Each answer
 * is checked against the contract and recorded as live evidence. Runs twice; every row it makes is removed.
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
  if (/\/transition$/.test(p)) return `${R}/{id}/transition`;
  return `${R}/{id}`;
};

function record(method, path, r) {
  if (!path.includes("/registrations")) return; // other routes (the model drafts) are recorded by their own checks
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

const MODEL = "/api/runtime/model-applications";

function cleanup(refs, twinIds, brandNames, probeBrand, modelIds = [], probeBrands = []) {
  if (modelIds.length) {
    const arr = modelIds.map((id) => `'${id}'`).join(",");
    sqlMaint(`SELECT set_config('bee.cleanup_schema', 'app', true); INSERT INTO app.local_disposable_application (application_id) SELECT unnest(ARRAY[${arr}]::uuid[]) ON CONFLICT DO NOTHING`);
    sqlMaint(`SELECT set_config('bee.cleanup_schema', 'app', true); SELECT app.app_disposable_model_cleanup(ARRAY[${arr}]::uuid[])`);
  }
  if (refs.length) {
    const apps = `SELECT id FROM app.registration_application WHERE reference IN (${refs.map((x) => `'${x}'`).join(",")})`;
    sqlMaint(`DELETE FROM app.register_status_event WHERE registration_id IN (${apps});
      DELETE FROM app.registration_fee_confirmation WHERE application_id IN (${apps});
      DELETE FROM app.registration_transition_event WHERE application_id IN (${apps});
      DELETE FROM app.registration_fee_snapshot WHERE application_id IN (${apps});
      DELETE FROM app.registration_submission_event WHERE application_id IN (${apps});
      DELETE FROM app.registration_document_version WHERE document_id IN (SELECT id FROM app.registration_document WHERE application_id IN (${apps}));
      DELETE FROM app.registration_document WHERE application_id IN (${apps});
      DELETE FROM app.registration_application WHERE id IN (${apps})`);
  }
  for (const b of [probeBrand, ...probeBrands].filter(Boolean)) {
    sqlMaint(`DELETE FROM app.agency_authorisation WHERE brand_id = '${b}'`);
  }
  if (brandNames.length) {
    sqlMaint(`DELETE FROM app.brand WHERE name IN (${brandNames.map((x) => `'${x}'`).join(",")}) AND source_reference LIKE 'REG-%'`);
  }
  for (const b of [probeBrand, ...probeBrands].filter(Boolean)) sqlMaint(`DELETE FROM app.brand WHERE id = '${b}'`);
  sqlApp(`DELETE FROM app.idempotency_record WHERE account_id IN (${twinIds})`);
}

async function runChecks(run, P) {
  const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const PERSONA = ["nova.applicant", "pixel.applicant", "bee.finance", "bee.programme", "bee.director", "bee.admin"];
  const twinIds = PERSONA.map((u) => `'${ids.accountId(u)}'`).join(",");
  const before = counts();
  const refs = [];
  const brandNames = [];
  let probeBrand = null;
  const probeBrands = [];
  const modelIds = [];

  /** Files a brand request with a licence, submits it and has Finance confirm the fee: ready for Programme at version 3. */
  async function toProgrammeReview(name) {
    brandNames.push(name);
    let r = await api(P.nova, "POST", `${WEB}${R}`, { brandName: name }, key());
    const reg = r.body;
    if (reg?.reference) refs.push(reg.reference);
    r = await api(P.nova, "PATCH", `${WEB}${R}/${reg.id}`, { version: 0, brandName: name }, key());
    r = await upload(P.nova, reg.id, minPdf(`${run}-${name}`), key());
    r = await api(P.nova, "GET", `${WEB}${R}/${reg.id}/submit`, null, null);
    const fee = r.body?.submissionFee;
    r = await api(P.nova, "POST", `${WEB}${R}/${reg.id}/submit`, { version: 1, expectedFee: { amountInr: fee.amountInr, feeRuleKey: fee.feeRuleKey, feeRuleVersion: fee.feeRuleVersion } }, key());
    r = await api(P.finance, "POST", `${WEB}${R}/${reg.id}/fee-confirmation`, { version: 2, receiptReference: `RCPT-${name.replace(/\W/g, "")}`.slice(0, 40), receivedOn: "2026-10-01", amountInr: fee.totalInr }, key());
    return { id: reg.id, reference: reg.reference, version: r.body?.version, fee };
  }
  const step = (who, id, action, version, note, k = key()) =>
    api(P[who], "POST", `${WEB}${R}/${id}/transition`, { action, version, ...(note ? { note } : {}) }, k);

  try {
    // 0. No session.
    const a = await anonymous("POST", `${R}/${NOVA_ORG}/transition`, {});
    check(`${run}.anonymous.POST-transition`, a.status === 401 && a.body?.error === "no_session", `${a.status} ${a.body?.error}`);

    // 1. Recommend and approve a brand.
    const name = `Rev ${tag}`;
    const q = await toProgrammeReview(name);
    check(`${run}.setup.ready-for-programme`, q.version === 3, `v${q.version}`);
    let r = await step("nova", q.id, "recommend", 3);
    check(`${run}.nova.cannot-recommend`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await step("director", q.id, "recommend", 3);
    check(`${run}.director.cannot-recommend`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await step("director", q.id, "approve", 3);
    check(`${run}.director.cannot-approve-before-recommendation`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await step("programme", q.id, "approve", 3);
    check(`${run}.programme.cannot-approve`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await step("programme", q.id, "bogus", 3);
    check(`${run}.programme.unknown-action-refused`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await step("programme", q.id, "return", 3);
    check(`${run}.programme.return-needs-a-reason`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await step("programme", q.id, "recommend", 2);
    check(`${run}.programme.stale-version-conflicts`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error}`);
    r = await api(P.programme, "POST", `${WEB}${R}/${q.id}/transition`, { action: "recommend", version: 3 }, null);
    check(`${run}.programme.key-required`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error}`);
    r = await step("admin", q.id, "recommend", 3);
    check(`${run}.admin.cannot-recommend`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    const kr = key();
    r = await step("programme", q.id, "recommend", 3, "Licence checked", kr);
    check(`${run}.programme.recommend-200`, r.status === 200 && r.body?.action === "recommend" && r.body?.toState === "director_approval" && r.body?.version === 4, `${r.status} ${r.body?.toState}`);
    r = await step("programme", q.id, "recommend", 3, "Licence checked", kr);
    check(`${run}.programme.recommend-replay`, r.status === 200 && r.replay === "true", `replay=${r.replay}`);
    r = await step("programme", q.id, "recommend", 3, "Other", kr);
    check(`${run}.programme.key-reuse-with-other-body-conflicts`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error}`);
    r = await step("programme", q.id, "recommend", 4);
    check(`${run}.programme.cannot-recommend-twice`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await step("programme", q.id, "approve", 4);
    check(`${run}.programme.cannot-approve-its-own-recommendation`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await step("nova", q.id, "approve", 4);
    check(`${run}.nova.cannot-approve`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.director, "GET", `${WEB}${R}/${q.id}`, null, null);
    check(`${run}.director.reads-the-approval-stage`, r.status === 200 && r.body?.state === "director_approval" && r.body?.trail?.map((t) => t.action).join() === "confirm_fee,recommend", `${r.status} ${r.body?.trail?.map((t) => t.action)}`);
    r = await api(P.nova, "GET", `${WEB}${R}/${q.id}`, null, null);
    check(`${run}.nova.does-not-see-the-recommendation`, r.status === 200 && r.body?.state === "director_approval" && (r.body?.trail ?? []).length === 0, `${r.status} ${r.body?.trail?.length}`);
    check(`${run}.db.nothing-registered-yet`, sqlApp(`SELECT count(*) FROM app.brand WHERE name = '${name}'`) === "0", "0");
    r = await step("director", q.id, "approve", 3);
    check(`${run}.director.stale-approve-conflicts`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error}`);
    const ka = key();
    r = await step("director", q.id, "approve", 4, "Approved on the provisional rules", ka);
    const brandId = r.body?.registeredBrandId;
    check(`${run}.director.approve-200`, r.status === 200 && r.body?.toState === "approved" && r.body?.version === 5 && /^[0-9a-f-]{36}$/.test(brandId ?? ""), `${r.status} ${r.body?.toState}`);
    r = await step("director", q.id, "approve", 4, "Approved on the provisional rules", ka);
    check(`${run}.director.approve-replay`, r.status === 200 && r.replay === "true" && r.body?.registeredBrandId === brandId, `replay=${r.replay}`);
    check(`${run}.db.brand-registered`, sqlApp(`SELECT count(*) || '|' || coalesce(max(status), '') || '|' || coalesce(max(owner_organisation_id::text), '') || '|' || coalesce(max(source_reference), '') FROM app.brand WHERE name = '${name}' AND id = '${brandId}'`) === `1|active|${NOVA_ORG}|${q.reference}`, "1|active");
    r = await api(P.nova, "GET", `${WEB}${R}/${q.id}`, null, null);
    check(`${run}.nova.sees-the-decision`, r.status === 200 && r.body?.state === "approved" && r.body?.registeredBrandId === brandId && r.body?.trail?.map((t) => t.action).join() === "approve" && r.body.trail[0].note === "Approved on the provisional rules", `${r.status} ${r.body?.state}`);
    r = await api(P.director, "GET", `${WEB}${R}`, null, null);
    check(`${run}.director.list-holds-the-decided-request`, r.status === 200 && r.body?.items?.some((x) => x.id === q.id && x.state === "approved"), `${r.status} ${r.body?.count}`);
    r = await step("director", q.id, "reject", 5, "too late");
    check(`${run}.director.cannot-reject-an-approved-request`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "POST", `${WEB}${R}`, { brandName: name.toLowerCase() }, key());
    check(`${run}.nova.registered-name-is-taken`, r.status === 409 && r.body?.error === "brand_name_taken", `${r.status} ${r.body?.error}`);

    // 2. Return, edit, resubmit (no second fee), then the Director returns and finally rejects.
    const name2 = `Ret ${tag}`;
    const s = await toProgrammeReview(name2);
    r = await step("programme", s.id, "return", 3, "The licence page is unreadable");
    check(`${run}.programme.return-200`, r.status === 200 && r.body?.toState === "returned" && r.body?.version === 4, `${r.status} ${r.body?.toState}`);
    r = await api(P.nova, "GET", `${WEB}${R}/${s.id}`, null, null);
    check(`${run}.nova.sees-why-it-was-returned`, r.status === 200 && r.body?.state === "returned" && r.body?.trail?.at(-1)?.note === "The licence page is unreadable" && r.body?.trail?.at(-1)?.actorRole === "programme", `${r.status} ${r.body?.trail?.at(-1)?.note}`);
    r = await step("nova", s.id, "resubmit", 3);
    check(`${run}.nova.stale-resubmit-conflicts`, r.status === 409 && r.body?.error === "version_conflict", `${r.status} ${r.body?.error}`);
    r = await step("programme", s.id, "resubmit", 4);
    check(`${run}.programme.cannot-resubmit`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await step("pixel", s.id, "resubmit", 4);
    check(`${run}.pixel.cannot-resubmit-anothers`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await upload(P.nova, s.id, minPdf(`${run}-fixed`), key(), { label: "Clearer licence" });
    check(`${run}.nova.can-upload-a-better-licence-when-returned`, r.status === 201 && r.body?.versions?.length === 2, `${r.status} ${r.body?.versions?.length}`);
    const name2b = `Ret ${tag} B`;
    brandNames.push(name2b);
    r = await api(P.nova, "PATCH", `${WEB}${R}/${s.id}`, { version: 4, brandName: name2b }, key());
    check(`${run}.nova.can-edit-when-returned`, r.status === 200 && r.body?.brandName === name2b && r.body?.state === "returned" && r.body?.version === 5, `${r.status} ${r.body?.state}`);
    r = await step("nova", s.id, "resubmit", 5);
    check(`${run}.nova.resubmit-200`, r.status === 200 && r.body?.toState === "programme_review" && r.body?.version === 6, `${r.status} ${r.body?.toState}`);
    check(`${run}.db.no-second-fee`, sqlApp(`SELECT (SELECT count(*) FROM app.registration_fee_snapshot WHERE application_id = '${s.id}') || '|' || (SELECT count(*) FROM app.registration_fee_confirmation WHERE application_id = '${s.id}')`) === "1|1", "1|1");
    r = await api(P.nova, "PATCH", `${WEB}${R}/${s.id}`, { version: 6, brandName: `${name2b} Late` }, key());
    check(`${run}.nova.cannot-edit-in-review`, r.status === 403 && r.body?.error === "not_editable", `${r.status} ${r.body?.error}`);
    r = await step("programme", s.id, "recommend", 6);
    check(`${run}.programme.recommends-the-resubmission`, r.status === 200 && r.body?.version === 7, `${r.status}`);
    r = await step("director", s.id, "reject", 7);
    check(`${run}.director.reject-needs-a-reason`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await step("director", s.id, "return", 7, "Add the second page");
    check(`${run}.director.return-200`, r.status === 200 && r.body?.fromState === "director_approval" && r.body?.toState === "returned", `${r.status} ${r.body?.toState}`);
    r = await step("nova", s.id, "resubmit", 8);
    check(`${run}.nova.resubmit-again-200`, r.status === 200 && r.body?.toState === "programme_review", `${r.status} ${r.body?.toState}`);
    r = await step("programme", s.id, "recommend", 9);
    r = await step("director", s.id, "reject", 10, "Name too close to a registered brand");
    check(`${run}.director.reject-200`, r.status === 200 && r.body?.toState === "rejected", `${r.status} ${r.body?.toState}`);
    r = await api(P.nova, "GET", `${WEB}${R}/${s.id}`, null, null);
    check(`${run}.nova.sees-the-rejection-reason`, r.status === 200 && r.body?.state === "rejected" && r.body?.trail?.at(-1)?.note === "Name too close to a registered brand", `${r.status} ${r.body?.state}`);
    check(`${run}.db.rejection-registered-nothing`, sqlApp(`SELECT count(*) FROM app.brand WHERE name IN ('${name2}', '${name2b}')`) === "0", "0");
    r = await step("nova", s.id, "resubmit", 11);
    check(`${run}.nova.rejected-is-final`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);

    // 3. An agency's request, approved: the authorisation is recorded and the register lists it.
    probeBrand = sqlApp(`INSERT INTO app.brand (name, owner_organisation_id, status, source_reference, verification_status, note) VALUES ('Probe ${tag}', '${NOVA_ORG}', 'active', 'live check', 'synthetic', 'probe') RETURNING id`).split("\n")[0];
    const t = await today();
    const from = await plusDays(t, 1);
    r = await api(P.pixel, "POST", `${WEB}${R}`, { brandId: probeBrand, validFrom: from, validTo: await plusDays(t, 400) }, key());
    const areg = r.body;
    if (areg?.reference) refs.push(areg.reference);
    await api(P.pixel, "PATCH", `${WEB}${R}/${areg.id}`, { version: 0, brandId: probeBrand, validFrom: from, validTo: await plusDays(t, 400) }, key());
    await upload(P.pixel, areg.id, minPdf(`${run}-agency`), key(), { label: "Agency licence" });
    r = await api(P.pixel, "GET", `${WEB}${R}/${areg.id}/submit`, null, null);
    const afee = r.body?.submissionFee;
    await api(P.pixel, "POST", `${WEB}${R}/${areg.id}/submit`, { version: 1, expectedFee: { amountInr: afee.amountInr, feeRuleKey: afee.feeRuleKey, feeRuleVersion: afee.feeRuleVersion } }, key());
    await api(P.finance, "POST", `${WEB}${R}/${areg.id}/fee-confirmation`, { version: 2, receiptReference: `RCPT-A-${tag}`, receivedOn: "2026-10-01", amountInr: afee.totalInr }, key());
    r = await step("programme", areg.id, "recommend", 3);
    check(`${run}.programme.agency-recommend-200`, r.status === 200 && r.body?.toState === "director_approval", `${r.status} ${r.body?.toState}`);
    r = await step("director", areg.id, "approve", 4);
    const authId = r.body?.registeredAuthorisationId;
    check(`${run}.director.agency-approve-200`, r.status === 200 && r.body?.toState === "approved" && /^[0-9a-f-]{36}$/.test(authId ?? "") && r.body?.registeredBrandId === undefined, `${r.status} ${r.body?.toState}`);
    check(`${run}.db.authorisation-recorded`, sqlApp(`SELECT count(*) || '|' || coalesce(max(status), '') || '|' || coalesce(max(valid_from::text), '') FROM app.agency_authorisation WHERE id = '${authId}' AND agency_organisation_id = '00000000-0000-4000-b000-000000000002' AND brand_id = '${probeBrand}' AND source_reference = '${areg.reference}'`) === `1|active|${from}`, "1|active");
    r = await api(P.pixel, "GET", `${WEB}${R}/${areg.id}`, null, null);
    check(`${run}.pixel.sees-its-authorisation`, r.status === 200 && r.body?.state === "approved" && r.body?.registeredAuthorisationId === authId, `${r.status} ${r.body?.state}`);
    r = await api(P.finance, "GET", `${WEB}${R}/${areg.id}`, null, null);
    check(`${run}.finance.cannot-read-a-decided-request`, r.status === 404, `${r.status}`);

    // 4. The register feeds the model flow: a registered brand can be filed on; an agency can file only inside its authorised period.
    const modelNo = (x) => `RV-${tag}-${x}`.toUpperCase();
    r = await api(P.nova, "GET", `${WEB}${MODEL}/eligible-brands`, null, null);
    check(`${run}.model.registered-brand-is-offered-to-its-owner`, r.status === 200 && r.body?.items?.some((b) => b.brandId === brandId), `${r.status} ${r.body?.count}`);
    r = await api(P.nova, "POST", `${WEB}${MODEL}`, { brandId, category: "RAC", modelNumber: modelNo("A") }, key());
    if (r.body?.id) modelIds.push(r.body.id);
    check(`${run}.model.owner-files-a-draft-on-the-registered-brand`, r.status === 201 && r.body?.state === "draft" && r.body?.brandId === brandId, `${r.status} ${r.body?.state}`);
    r = await api(P.pixel, "POST", `${WEB}${MODEL}`, { brandId, category: "RAC", modelNumber: modelNo("B") }, key());
    check(`${run}.model.agency-without-authorisation-is-refused`, r.status === 403 && r.body?.error === "brand_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.pixel, "POST", `${WEB}${MODEL}`, { brandId: probeBrand, category: "RAC", modelNumber: modelNo("C") }, key());
    check(`${run}.model.authorisation-starting-tomorrow-is-not-yet-usable`, r.status === 403 && r.body?.error === "brand_not_permitted", `${r.status} ${r.body?.error}`);

    // An authorisation that starts today, approved through the same workflow, is usable at once; revoked, it is not.
    const probe2 = sqlApp(`INSERT INTO app.brand (name, owner_organisation_id, status, source_reference, verification_status, note) VALUES ('Probe2 ${tag}', '${NOVA_ORG}', 'active', 'live check', 'synthetic', 'probe') RETURNING id`).split("\n")[0];
    probeBrands.push(probe2);
    r = await api(P.pixel, "POST", `${WEB}${R}`, { brandId: probe2, validFrom: t }, key());
    const b2 = r.body;
    if (b2?.reference) refs.push(b2.reference);
    await api(P.pixel, "PATCH", `${WEB}${R}/${b2.id}`, { version: 0, brandId: probe2, validFrom: t }, key());
    await upload(P.pixel, b2.id, minPdf(`${run}-agency2`), key(), { label: "Agency licence" });
    r = await api(P.pixel, "GET", `${WEB}${R}/${b2.id}/submit`, null, null);
    const f2 = r.body?.submissionFee;
    await api(P.pixel, "POST", `${WEB}${R}/${b2.id}/submit`, { version: 1, expectedFee: { amountInr: f2.amountInr, feeRuleKey: f2.feeRuleKey, feeRuleVersion: f2.feeRuleVersion } }, key());
    await api(P.finance, "POST", `${WEB}${R}/${b2.id}/fee-confirmation`, { version: 2, receiptReference: `RCPT-B-${tag}`, receivedOn: "2026-10-01", amountInr: f2.totalInr }, key());
    await step("programme", b2.id, "recommend", 3);
    r = await step("director", b2.id, "approve", 4);
    check(`${run}.model.second-authorisation-approved`, r.status === 200 && !!r.body?.registeredAuthorisationId, `${r.status}`);
    r = await api(P.pixel, "GET", `${WEB}${MODEL}/eligible-brands`, null, null);
    check(`${run}.model.agency-is-offered-the-authorised-brand`, r.status === 200 && r.body?.items?.some((b) => b.brandId === probe2), `${r.status} ${r.body?.count}`);
    r = await api(P.pixel, "POST", `${WEB}${MODEL}`, { brandId: probe2, category: "RAC", modelNumber: modelNo("D") }, key());
    if (r.body?.id) modelIds.push(r.body.id);
    check(`${run}.model.agency-files-inside-its-period`, r.status === 201 && r.body?.brandId === probe2, `${r.status} ${r.body?.state}`);
    sqlApp(`UPDATE app.agency_authorisation SET status = 'revoked' WHERE brand_id = '${probe2}'`);
    r = await api(P.pixel, "POST", `${WEB}${MODEL}`, { brandId: probe2, category: "RAC", modelNumber: modelNo("E") }, key());
    check(`${run}.model.revoked-authorisation-is-refused`, r.status === 403 && r.body?.error === "brand_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.pixel, "GET", `${WEB}${MODEL}/eligible-brands`, null, null);
    check(`${run}.model.revoked-brand-is-no-longer-offered`, r.status === 200 && !r.body?.items?.some((b) => b.brandId === probe2), `${r.status} ${r.body?.count}`);
  } finally {
    cleanup(refs, twinIds, brandNames, probeBrand, modelIds, probeBrands);
  }
  check(`${run}.db.cleaned-up`, counts() === before, counts());
}

async function main() {
  const chrome = await launchChrome();
  try {
    const who = { nova: ids.name("nova.applicant"), pixel: ids.name("pixel.applicant"), finance: ids.name("bee.finance"), programme: ids.name("bee.programme"), director: ids.name("bee.director"), admin: ids.name("bee.admin") };
    const P = {};
    for (const [k, u] of Object.entries(who)) {
      await totp.ensureEnrolled(u);
      P[k] = await openPage(chrome.cdp);
      if (!(await signIn(P[k], u))) throw new Error(`${k} sign-in failed`);
    }
    await runChecks("registration-review.run1", P);
    await runChecks("registration-review.run2", P);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("registration-review.run", false, String(e.message)))
  .then(() => {
    console.log(`registration review checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
