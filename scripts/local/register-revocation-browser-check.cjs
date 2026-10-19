/* eslint-disable */
/**
 * Closing and revoking register entries (WP04.2b-2b), through the portal API with real roles. Programme proposes, the Director decides, never
 * the proposer; approval revokes a brand (its authorisations go with it) or revokes or closes an agency authorisation, and the model flow then
 * refuses what is no longer authorised. Each answer is checked against the contract and recorded as live evidence. Runs twice; every row it
 * makes is removed.
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
const R = "/api/runtime/register-revocations";
const routeOf = (path) => {
  const p = path.replace(WEB, "").split("?")[0];
  return p === R ? R : `${R}/{id}/decision`;
};

function record(method, path, r) {
  if (!path.includes("/register-revocations")) return; // other routes (the model drafts) are recorded by their own checks
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
const PIXEL_ORG = "00000000-0000-4000-b000-000000000002";

function cleanup(twinIds, brandIds, modelIds) {
  if (modelIds.length) {
    const arr = modelIds.map((id) => `'${id}'`).join(",");
    sqlMaint(`SELECT set_config('bee.cleanup_schema', 'app', true); INSERT INTO app.local_disposable_application (application_id) SELECT unnest(ARRAY[${arr}]::uuid[]) ON CONFLICT DO NOTHING`);
    sqlMaint(`SELECT set_config('bee.cleanup_schema', 'app', true); SELECT app.app_disposable_model_cleanup(ARRAY[${arr}]::uuid[])`);
  }
  if (brandIds.length) {
    const list = brandIds.map((b) => `'${b}'`).join(",");
    sqlMaint(`DELETE FROM app.register_status_event WHERE brand_id IN (${list}) OR authorisation_id IN (SELECT id FROM app.agency_authorisation WHERE brand_id IN (${list}));
      DELETE FROM app.register_revocation_proposal WHERE target_brand_id IN (${list}) OR target_authorisation_id IN (SELECT id FROM app.agency_authorisation WHERE brand_id IN (${list}));
      DELETE FROM app.agency_authorisation WHERE brand_id IN (${list});
      DELETE FROM app.brand WHERE id IN (${list})`);
  }
  sqlApp(`DELETE FROM app.idempotency_record WHERE account_id IN (${twinIds})`);
}

async function runChecks(run, P) {
  const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const PERSONA = ["nova.applicant", "pixel.applicant", "bee.programme", "bee.officer", "bee.admin"];
  const twinIds = PERSONA.map((u) => `'${ids.accountId(u)}'`).join(",");
  const before = counts();
  const brandIds = [];
  const modelIds = [];
  const newBrand = (name) => {
    const b = sqlApp(`INSERT INTO app.brand (name, owner_organisation_id, status, source_reference, verification_status, note) VALUES ('${name}', '${NOVA_ORG}', 'active', 'live check', 'synthetic', 'probe') RETURNING id`).split("\n")[0];
    brandIds.push(b);
    const a = sqlApp(`INSERT INTO app.agency_authorisation (agency_organisation_id, principal_organisation_id, brand_id, valid_from, status, source_reference, verification_status, note) VALUES ('${PIXEL_ORG}', '${NOVA_ORG}', '${b}', (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, 'active', 'live check', 'synthetic', 'probe') RETURNING id`).split("\n")[0];
    return { brand: b, auth: a };
  };
  const propose = (who, kind, id, action, extra = {}) => api(P[who], "POST", `${WEB}${R}`, { targetKind: kind, targetId: id, action, reason: "Licence withdrawn by the owner", ...extra }, key());
  const decide = (who, id, decision, note, k = key()) => api(P[who], "POST", `${WEB}${R}/${id}/decision`, { decision, ...(note ? { note } : {}) }, k);
  const status = (table, id) => sqlApp(`SELECT status FROM app.${table} WHERE id = '${id}'`);

  try {
    // 0. No session; the wrong roles.
    for (const [m, p, b] of [["GET", R], ["POST", R, {}], ["POST", `${R}/${NOVA_ORG}/decision`, {}]]) {
      const a = await anonymous(m, p, b);
      check(`${run}.anonymous.${m}-${routeOf(p) === R ? "list" : "decision"}`, a.status === 401 && a.body?.error === "no_session", `${a.status} ${a.body?.error}`);
    }
    for (const who of ["nova", "pixel"]) {
      const r = await api(P[who], "GET", `${WEB}${R}`, null, null);
      check(`${run}.${who}.cannot-read-the-register-view`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    }
    // 1. Programme proposes revoking a brand; the Director decides.
    const x = newBrand(`Rvk ${tag}`);
    {
      const r = await api(P.admin, "GET", `${WEB}${R}`, null, null);
      check(`${run}.admin.reads-the-register-read-only`, r.status === 200 && r.body?.canPropose === false && r.body?.canDecide === false, `${r.status} propose=${r.body?.canPropose}`);
      const bad = await propose("admin", "brand", x.brand, "revoke");
      check(`${run}.admin.cannot-propose`, bad.status === 403 && bad.body?.error === "role_not_permitted", `${bad.status} ${bad.body?.error}`);
    }
    let r = await api(P.programme, "GET", `${WEB}${R}`, null, null);
    check(`${run}.programme.reads-the-register`, r.status === 200 && r.body?.canPropose === true && r.body?.canDecide === false && r.body?.brands?.some((b) => b.id === x.brand && b.status === "active") && r.body?.authorisations?.some((a) => a.id === x.auth), `${r.status}`);
    r = await api(P.director, "GET", `${WEB}${R}`, null, null);
    check(`${run}.director.reads-it-and-may-decide-only`, r.status === 200 && r.body?.canPropose === false && r.body?.canDecide === true, `${r.status}`);
    r = await propose("director", "brand", x.brand, "revoke");
    check(`${run}.director.cannot-propose`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await propose("nova", "brand", x.brand, "revoke");
    check(`${run}.nova.cannot-propose`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.programme, "POST", `${WEB}${R}`, { targetKind: "brand", targetId: x.brand, action: "revoke", reason: "r" }, null);
    check(`${run}.programme.key-required`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error}`);
    for (const [label, b] of [["empty", {}], ["brand-close", { targetKind: "brand", targetId: x.brand, action: "close", closeOn: "2999-01-01", reason: "r" }], ["blank-reason", { targetKind: "brand", targetId: x.brand, action: "revoke", reason: " " }], ["bad-id", { targetKind: "brand", targetId: "nope", action: "revoke", reason: "r" }]]) {
      r = await api(P.programme, "POST", `${WEB}${R}`, b, key());
      check(`${run}.programme.refuses-${label}`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    }
    r = await propose("programme", "brand", crypto.randomUUID(), "revoke");
    check(`${run}.programme.unknown-record-404`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    const kp = key();
    r = await api(P.programme, "POST", `${WEB}${R}`, { targetKind: "brand", targetId: x.brand, action: "revoke", reason: "Licence withdrawn by the owner" }, kp);
    const p1 = r.body;
    check(`${run}.programme.propose-201`, r.status === 201 && p1?.state === "pending" && p1?.action === "revoke" && p1?.targetLabel === `Rvk ${tag}` && p1?.proposedByYou === true, `${r.status} ${p1?.state}`);
    r = await api(P.programme, "POST", `${WEB}${R}`, { targetKind: "brand", targetId: x.brand, action: "revoke", reason: "Licence withdrawn by the owner" }, kp);
    check(`${run}.programme.propose-replay`, r.status === 201 && r.replay === "true" && r.body?.id === p1.id, `replay=${r.replay}`);
    r = await propose("programme", "brand", x.brand, "revoke");
    check(`${run}.programme.second-proposal-refused`, r.status === 409 && r.body?.error === "revocation_pending", `${r.status} ${r.body?.error}`);
    r = await decide("programme", p1.id, "approve");
    check(`${run}.programme.cannot-approve-its-own`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await decide("nova", p1.id, "approve");
    check(`${run}.nova.cannot-decide`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await decide("director", p1.id, "reject");
    check(`${run}.director.reject-needs-a-note`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await decide("director", p1.id, "withdraw");
    check(`${run}.director.cannot-withdraw`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await decide("director", crypto.randomUUID(), "approve");
    check(`${run}.director.unknown-proposal-404`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    check(`${run}.db.nothing-changed-before-approval`, status("brand", x.brand) === "active" && status("agency_authorisation", x.auth) === "active", "active");
    r = await api(P.nova, "POST", `${WEB}${MODEL}`, { brandId: x.brand, category: "RAC", modelNumber: `RK-${tag}-A`.toUpperCase() }, key());
    if (r.body?.id) modelIds.push(r.body.id);
    check(`${run}.model.owner-can-file-before-revocation`, r.status === 201, `${r.status}`);
    const kd = key();
    r = await decide("director", p1.id, "approve", "Agreed", kd);
    check(`${run}.director.approve-200`, r.status === 200 && r.body?.state === "approved" && r.body?.decidedBy && r.body?.decisionNote === "Agreed", `${r.status} ${r.body?.state}`);
    r = await decide("director", p1.id, "approve", "Agreed", kd);
    check(`${run}.director.approve-replay`, r.status === 200 && r.replay === "true", `replay=${r.replay}`);
    r = await decide("director", p1.id, "approve", "Again");
    check(`${run}.director.cannot-decide-twice`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);
    check(`${run}.db.brand-and-authorisation-revoked`, status("brand", x.brand) === "revoked" && status("agency_authorisation", x.auth) === "revoked", "revoked");
    r = await propose("programme", "authorisation", x.auth, "revoke");
    check(`${run}.programme.cannot-propose-for-a-revoked-record`, r.status === 409 && r.body?.error === "target_not_active", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "POST", `${WEB}${MODEL}`, { brandId: x.brand, category: "RAC", modelNumber: `RK-${tag}-B`.toUpperCase() }, key());
    check(`${run}.model.owner-is-refused-after-revocation`, r.status === 403 && r.body?.error === "brand_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.pixel, "POST", `${WEB}${MODEL}`, { brandId: x.brand, category: "RAC", modelNumber: `RK-${tag}-C`.toUpperCase() }, key());
    check(`${run}.model.agency-is-refused-after-revocation`, r.status === 403 && r.body?.error === "brand_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "GET", `${WEB}${MODEL}/eligible-brands`, null, null);
    check(`${run}.model.revoked-brand-no-longer-offered`, r.status === 200 && !r.body?.items?.some((b) => b.brandId === x.brand), `${r.status}`);
    r = await api(P.director, "GET", `${WEB}${R}`, null, null);
    check(`${run}.director.sees-the-decision-in-history`, r.status === 200 && r.body?.decided?.some((d) => d.id === p1.id && d.state === "approved") && !r.body?.pending?.some((d) => d.id === p1.id), `${r.status}`);

    // 2. Close an authorisation on a date; withdraw; reject; approve.
    const y = newBrand(`Cls ${tag}`);
    const t = await today();
    const inTen = await plusDays(t, 10);
    r = await propose("programme", "authorisation", y.auth, "close");
    check(`${run}.programme.close-needs-a-date`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await propose("programme", "authorisation", y.auth, "close", { closeOn: await plusDays(t, -1) });
    check(`${run}.programme.close-date-in-the-past-refused`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await propose("programme", "authorisation", y.auth, "close", { closeOn: await plusDays(t, -5) });
    check(`${run}.programme.close-before-the-start-refused`, r.status === 422, `${r.status}`);
    r = await propose("programme", "authorisation", y.auth, "revoke", { closeOn: inTen });
    check(`${run}.programme.revoke-takes-no-date`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await propose("programme", "authorisation", y.auth, "close", { closeOn: inTen });
    const c1 = r.body;
    check(`${run}.programme.close-propose-201`, r.status === 201 && c1?.action === "close" && c1?.closeOn === inTen && c1?.targetKind === "authorisation", `${r.status} ${c1?.closeOn}`);
    r = await decide("director", c1.id, "withdraw");
    check(`${run}.director.cannot-withdraw-anothers`, r.status === 403, `${r.status}`);
    r = await decide("programme", c1.id, "withdraw");
    check(`${run}.programme.withdraw-200`, r.status === 200 && r.body?.state === "withdrawn", `${r.status} ${r.body?.state}`);
    r = await propose("programme", "authorisation", y.auth, "close", { closeOn: inTen });
    const c2 = r.body;
    r = await decide("director", c2.id, "reject", "Not warranted");
    check(`${run}.director.reject-200`, r.status === 200 && r.body?.state === "rejected" && r.body?.decisionNote === "Not warranted", `${r.status} ${r.body?.state}`);
    check(`${run}.db.rejected-changed-nothing`, status("agency_authorisation", y.auth) === "active" && sqlApp(`SELECT coalesce(valid_to::text, 'open') FROM app.agency_authorisation WHERE id = '${y.auth}'`) === "open", "open");
    r = await propose("programme", "authorisation", y.auth, "close", { closeOn: inTen });
    const c3 = r.body;
    r = await decide("director", c3.id, "approve");
    check(`${run}.director.close-approve-200`, r.status === 200 && r.body?.state === "approved", `${r.status} ${r.body?.state}`);
    check(`${run}.db.authorisation-ends-on-the-date`, sqlApp(`SELECT valid_to::text || '|' || status FROM app.agency_authorisation WHERE id = '${y.auth}'`) === `${inTen}|active`, `${inTen}|active`);
    check(`${run}.db.brand-untouched-by-a-closure`, status("brand", y.brand) === "active", "active");
    r = await api(P.pixel, "POST", `${WEB}${MODEL}`, { brandId: y.brand, category: "RAC", modelNumber: `RK-${tag}-D`.toUpperCase() }, key());
    if (r.body?.id) modelIds.push(r.body.id);
    check(`${run}.model.agency-still-files-until-the-closing-date`, r.status === 201, `${r.status} ${r.body?.error}`);
    r = await propose("programme", "authorisation", y.auth, "close", { closeOn: await plusDays(t, 20) });
    check(`${run}.programme.cannot-close-after-the-end`, r.status === 409 && r.body?.error === "target_not_active", `${r.status} ${r.body?.error}`);
  } finally {
    cleanup(twinIds, brandIds, modelIds);
  }
  check(`${run}.db.cleaned-up`, counts() === before, counts());
}

async function main() {
  const chrome = await launchChrome();
  try {
    const who = { nova: ids.name("nova.applicant"), pixel: ids.name("pixel.applicant"), programme: ids.name("bee.programme"), director: ids.name("bee.officer"), admin: ids.name("bee.admin") };
    const P = {};
    for (const [k, u] of Object.entries(who)) {
      await totp.ensureEnrolled(u);
      P[k] = await openPage(chrome.cdp);
      if (!(await signIn(P[k], u))) throw new Error(`${k} sign-in failed`);
    }
    await runChecks("revocation.run1", P);
    await runChecks("revocation.run2", P);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("revocation.run", false, String(e.message)))
  .then(() => {
    console.log(`revocation checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
