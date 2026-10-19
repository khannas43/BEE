/* eslint-disable */
/**
 * Delegation of a stage role (WP02.4c), through the portal API with real roles. The Director asks to delegate the Director role to a colleague
 * (Finance); the Administrator approves; the delegate then reads and acts at the Director stage, every use is logged, segregation of duties
 * counts the delegator, and revocation ends it at once. Nobody else can delegate, approve or revoke. Each answer is checked against the
 * contract and recorded as live evidence. Runs twice; every row it makes is removed.
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
const R = "/api/runtime/delegations";
const routeOf = (path) => {
  const p = path.replace(WEB, "").split("?")[0];
  return p === R ? R : `${R}/{id}/decision`;
};

function record(method, path, r) {
  if (!path.includes("/delegations")) return; // other routes (the model drafts) are recorded by their own checks
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
const NOVA_ORG_ID = "00000000-0000-4000-b000-000000000001";

function cleanup(twinIds, appIds) {
  if (appIds.length) {
    const arr = appIds.map((id) => `'${id}'`).join(",");
    sqlMaint(`SELECT set_config('bee.cleanup_schema', 'app', true); INSERT INTO app.local_disposable_application (application_id) SELECT unnest(ARRAY[${arr}]::uuid[]) ON CONFLICT DO NOTHING`);
    sqlMaint(`SELECT set_config('bee.cleanup_schema', 'app', true); SELECT app.app_disposable_model_cleanup(ARRAY[${arr}]::uuid[])`);
  }
  sqlMaint(`DELETE FROM app.delegation_use WHERE delegation_id IN (SELECT id FROM app.delegation WHERE delegator_id IN (${twinIds}) OR delegate_id IN (${twinIds}));
    DELETE FROM app.delegation_event WHERE delegation_id IN (SELECT id FROM app.delegation WHERE delegator_id IN (${twinIds}) OR delegate_id IN (${twinIds}));
    DELETE FROM app.delegation WHERE delegator_id IN (${twinIds}) OR delegate_id IN (${twinIds})`);
  sqlApp(`DELETE FROM app.idempotency_record WHERE account_id IN (${twinIds})`);
}

async function runChecks(run, P) {
  const tag = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const PERSONA = ["nova.applicant", "bee.programme", "bee.officer", "bee.finance", "bee.admin", "bee.director"];
  const twinIds = PERSONA.map((u) => `'${ids.accountId(u)}'`).join(",");
  const before = sqlApp(`SELECT count(*) FROM app.model_application`) + "|" + sqlApp(`SELECT count(*) FROM app.role_assignment`);
  const appIds = [];
  const disposable = (state, n) => {
    const id = crypto.randomUUID();
    appIds.push(id);
    sqlApp(`INSERT INTO app.model_application (id, reference, organisation_id, brand_name, category, model_number, state, version) VALUES ('${id}', 'LOCAL-MA-D${tag.toUpperCase()}${n}', '${NOVA_ORG_ID}', 'Nova Cool', 'RAC', 'DEL-${tag}-${n}', '${state}', 0)`);
    return id;
  };
  const financeId = ids.accountId("bee.finance"), directorId = ids.accountId("bee.officer"), programmeId = ids.accountId("bee.programme");
  const today = await sqlApp(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text`);
  const ask = (who, delegateId, role, from, to, reason = "Away on leave") => api(P[who], "POST", `${WEB}${R}`, { delegateId, role, validFrom: from, validTo: to, reason }, key());
  const decide = (who, id, decision, note, k = key()) => api(P[who], "POST", `${WEB}${R}/${id}/decision`, { decision, ...(note ? { note } : {}) }, k);
  const ret = (who, appId, version = 0) => api(P[who], "POST", `${WEB}${MODEL}/${appId}/return`, { version, reason: "Delegated return" }, key());

  try {
    // 0. No session; who can delegate.
    for (const [m, p, b] of [["GET", R], ["POST", R, {}], ["POST", `${R}/${NOVA_ORG_ID}/decision`, {}]]) {
      const a = await anonymous(m, p, b);
      check(`${run}.anonymous.${m}-${routeOf(p) === R ? "list" : "decision"}`, a.status === 401 && a.body?.error === "no_session", `${a.status} ${a.body?.error}`);
    }
    let r = await api(P.nova, "GET", `${WEB}${R}`, null, null);
    check(`${run}.nova.has-nothing-to-delegate`, r.status === 200 && r.body?.delegableRoles?.length === 0 && r.body?.colleagues?.length === 0 && r.body?.canApprove === false, `${r.status} ${JSON.stringify(r.body?.delegableRoles)}`);
    r = await ask("nova", financeId, "officer", today, await plusDays(today, 5));
    check(`${run}.nova.cannot-delegate`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    for (const who of ["secretary", "admin"]) {
      r = await ask(who, financeId, "officer", today, await plusDays(today, 5));
      check(`${run}.${who}.cannot-delegate`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    }
    r = await api(P.director, "GET", `${WEB}${R}`, null, null);
    check(`${run}.director.may-delegate-the-director-role`, r.status === 200 && r.body?.delegableRoles?.join() === "officer" && r.body?.colleagues?.some((c) => c.id === financeId) && !r.body?.colleagues?.some((c) => c.id === ids.accountId("nova.applicant")), `${r.status} ${JSON.stringify(r.body?.delegableRoles)}`);

    // 1. Requests are checked.
    const to5 = await plusDays(today, 5);
    r = await ask("director", financeId, "secretary", today, to5);
    check(`${run}.director.cannot-delegate-the-secretary-role`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await ask("director", financeId, "programme", today, to5);
    check(`${run}.director.cannot-delegate-a-role-they-do-not-hold`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await ask("director", directorId, "officer", today, to5);
    check(`${run}.director.cannot-delegate-to-themselves`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await ask("director", financeId, "officer", await plusDays(today, -1), to5);
    check(`${run}.director.start-in-the-past-refused`, r.status === 422, `${r.status} ${r.body?.error}`);
    r = await ask("director", financeId, "officer", today, await plusDays(today, 31));
    check(`${run}.director.more-than-thirty-days-refused`, r.status === 422, `${r.status} ${r.body?.error}`);
    r = await ask("director", ids.accountId("nova.applicant"), "officer", today, to5);
    check(`${run}.director.other-organisation-not-eligible`, r.status === 409 && r.body?.error === "delegate_not_eligible", `${r.status} ${r.body?.error}`);
    r = await ask("director", crypto.randomUUID(), "officer", today, to5);
    check(`${run}.director.unknown-person-404`, r.status === 404 && r.body?.error === "not_found", `${r.status} ${r.body?.error}`);
    r = await api(P.director, "POST", `${WEB}${R}`, { delegateId: financeId, role: "officer", validFrom: today, validTo: to5, reason: "x" }, null);
    check(`${run}.director.key-required`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error}`);

    // 2. Before approval the delegate has nothing.
    const app1 = disposable("director_review", "A");
    r = await ret("finance", app1);
    check(`${run}.finance.cannot-act-at-the-director-stage-yet`, r.status === 404 || r.status === 403, `${r.status} ${r.body?.error}`);
    const k1 = key();
    r = await api(P.director, "POST", `${WEB}${R}`, { delegateId: financeId, role: "officer", validFrom: today, validTo: to5, reason: "Away on leave" }, k1);
    const d1 = r.body;
    check(`${run}.director.request-201`, r.status === 201 && d1?.state === "pending" && d1?.role === "officer" && d1?.inForce === false && d1?.asDelegator === true, `${r.status} ${d1?.state}`);
    r = await api(P.director, "POST", `${WEB}${R}`, { delegateId: financeId, role: "officer", validFrom: today, validTo: to5, reason: "Away on leave" }, k1);
    check(`${run}.director.request-replay`, r.status === 201 && r.replay === "true" && r.body?.id === d1.id, `replay=${r.replay}`);
    r = await ask("director", financeId, "officer", today, to5);
    check(`${run}.director.second-open-request-refused`, r.status === 409 && r.body?.error === "delegation_exists", `${r.status} ${r.body?.error}`);
    r = await ret("finance", app1);
    check(`${run}.finance.still-cannot-act-while-pending`, r.status === 404 || r.status === 403, `${r.status} ${r.body?.error}`);

    // 3. Three people: not the delegator, not the delegate, not a stranger; the Administrator is the checker.
    for (const [who, label] of [["director", "delegator"], ["finance", "delegate"], ["programme", "other-officer"], ["nova", "applicant"]]) {
      r = await decide(who, d1.id, "approve");
      check(`${run}.${label}.cannot-approve`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    }
    r = await decide("admin", d1.id, "reject");
    check(`${run}.admin.reject-needs-a-reason`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    r = await decide("admin", crypto.randomUUID(), "approve");
    check(`${run}.admin.unknown-delegation-404`, r.status === 404, `${r.status}`);
    r = await api(P.admin, "GET", `${WEB}${R}`, null, null);
    check(`${run}.admin.sees-the-pending-request`, r.status === 200 && r.body?.canApprove === true && r.body?.pending?.some((x) => x.id === d1.id), `${r.status} ${r.body?.pending?.length}`);
    const ka = key();
    r = await decide("admin", d1.id, "approve", "Cover agreed", ka);
    check(`${run}.admin.approve-200`, r.status === 200 && r.body?.state === "approved" && r.body?.inForce === true && r.body?.decisionNote === "Cover agreed", `${r.status} ${r.body?.state}`);
    r = await decide("admin", d1.id, "approve", "Cover agreed", ka);
    check(`${run}.admin.approve-replay`, r.status === 200 && r.replay === "true", `replay=${r.replay}`);
    r = await decide("admin", d1.id, "approve");
    check(`${run}.admin.cannot-approve-twice`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "GET", `${WEB}${R}`, null, null);
    check(`${run}.finance.sees-the-delegation-as-delegate`, r.status === 200 && r.body?.mine?.some((x) => x.id === d1.id && x.asDelegate === true && x.inForce === true), `${r.status}`);

    // 4. The delegate holds the Director role, no more.
    r = await api(P.finance, "GET", `${WEB}${MODEL}`, null, null);
    check(`${run}.finance.reads-the-director-stage`, r.status === 200 && r.body?.items?.some((x) => x.id === app1 && x.state === "director_review"), `${r.status} ${r.body?.count}`);
    r = await api(P.finance, "POST", `${WEB}${MODEL}/${app1}/secretary-approval`, { version: 0, note: "x" }, key());
    check(`${run}.finance.has-no-secretary-role-by-delegation`, r.status === 403 || r.status === 404, `${r.status} ${r.body?.error}`);
    const usesBefore = sqlApp(`SELECT count(*) FROM app.delegation_use WHERE delegation_id = '${d1.id}'`);
    r = await ret("finance", app1);
    check(`${run}.finance.acts-as-the-director-200`, r.status === 200 && r.body?.fromState === "director_review" && r.body?.toState === "returned", `${r.status} ${r.body?.toState ?? r.body?.error}`);
    const use = sqlApp(`SELECT acting_account_id || '|' || delegator_id || '|' || role || '|' || method || '|' || status FROM app.delegation_use WHERE delegation_id = '${d1.id}' ORDER BY occurred_at DESC LIMIT 1`);
    check(`${run}.db.the-use-is-logged`, usesBefore === "0" && use === `${financeId}|${directorId}|officer|POST|200`, use);
    const hist = sqlApp(`SELECT actor_account_id || '|' || actor_role FROM app.model_application_transition_event WHERE application_id = '${app1}' AND action = 'return' LIMIT 1`);
    check(`${run}.db.the-history-names-the-person-who-acted`, hist.startsWith(financeId), hist);
    r = await api(P.finance, "GET", `${WEB}${R}`, null, null);
    check(`${run}.finance.sees-one-use`, r.body?.mine?.find((x) => x.id === d1.id)?.uses === 1, `uses=${r.body?.mine?.find((x) => x.id === d1.id)?.uses}`);
    // a read, a refused write and an own-role action are not uses
    await api(P.finance, "GET", `${WEB}${MODEL}`, null, null);
    await ret("finance", app1);
    check(`${run}.db.reads-and-refusals-are-not-uses`, sqlApp(`SELECT count(*) FROM app.delegation_use WHERE delegation_id = '${d1.id}'`) === "1", "1");

    // 5. Segregation counts the delegator: the Director already acted on this application at another stage.
    const app2 = disposable("director_review", "B");
    sqlApp(`INSERT INTO app.model_application_transition_event (application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) VALUES ('${app2}', 'delegation_probe', 'rating', 'director_review', '${directorId}', 'director', 1)`);
    r = await ret("finance", app2);
    check(`${run}.finance.refused-where-the-delegator-acted-before`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);

    // 6. Revocation: only the delegator or the Administrator; at once.
    const app3 = disposable("director_review", "C");
    r = await decide("finance", d1.id, "revoke");
    check(`${run}.finance.delegate-cannot-revoke`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await decide("programme", d1.id, "revoke");
    check(`${run}.programme.stranger-cannot-revoke`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await decide("director", d1.id, "withdraw");
    check(`${run}.director.cannot-withdraw-an-approved-delegation`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);
    r = await decide("director", d1.id, "revoke", "Back early");
    check(`${run}.director.revoke-200`, r.status === 200 && r.body?.state === "revoked" && r.body?.inForce === false && r.body?.revokeNote === "Back early", `${r.status} ${r.body?.state}`);
    r = await ret("finance", app3);
    check(`${run}.finance.cannot-act-after-revocation`, r.status === 404 || r.status === 403, `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "GET", `${WEB}${MODEL}`, null, null);
    check(`${run}.finance.no-longer-reads-the-director-stage`, r.status === 200 && !r.body?.items?.some((x) => x.id === app3), `${r.status}`);
    r = await decide("director", d1.id, "revoke");
    check(`${run}.director.cannot-revoke-twice`, r.status === 409 && r.body?.error === "delegation_not_active", `${r.status} ${r.body?.error}`);

    // 7. Withdraw and reject; the Administrator can revoke too.
    r = await ask("director", financeId, "officer", today, to5);
    const d2 = r.body;
    r = await decide("finance", d2.id, "withdraw");
    check(`${run}.finance.only-the-delegator-withdraws`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await decide("director", d2.id, "withdraw", "Changed my mind");
    check(`${run}.director.withdraw-200`, r.status === 200 && r.body?.state === "withdrawn", `${r.status} ${r.body?.state}`);
    r = await ask("director", financeId, "officer", today, to5);
    const d3 = r.body;
    r = await decide("admin", d3.id, "reject", "Not needed");
    check(`${run}.admin.reject-200`, r.status === 200 && r.body?.state === "rejected" && r.body?.decisionNote === "Not needed", `${r.status} ${r.body?.state}`);
    r = await ask("director", financeId, "officer", today, to5);
    const d4 = r.body;
    await decide("admin", d4.id, "approve");
    r = await decide("admin", d4.id, "revoke", "Policy");
    check(`${run}.admin.can-revoke`, r.status === 200 && r.body?.state === "revoked" && r.body?.revokedBy, `${r.status} ${r.body?.state}`);
    check(`${run}.db.every-step-is-in-the-trail`, sqlApp(`SELECT string_agg(action, ',' ORDER BY action) FROM app.delegation_event WHERE delegation_id = '${d1.id}'`) === "approved,requested,revoked", sqlApp(`SELECT string_agg(action, ',' ORDER BY action) FROM app.delegation_event WHERE delegation_id = '${d1.id}'`));
  } finally {
    cleanup(twinIds, appIds);
  }
  const after = sqlApp(`SELECT count(*) FROM app.model_application`) + "|" + sqlApp(`SELECT count(*) FROM app.role_assignment`);
  check(`${run}.db.cleaned-up`, before === after && sqlApp(`SELECT count(*) FROM app.delegation WHERE delegator_id IN (${twinIds}) OR delegate_id IN (${twinIds})`) === "0", after);
}

async function main() {
  const chrome = await launchChrome();
  try {
    const who = { nova: ids.name("nova.applicant"), programme: ids.name("bee.programme"), director: ids.name("bee.officer"), finance: ids.name("bee.finance"), admin: ids.name("bee.admin"), secretary: ids.name("bee.director") };
    const P = {};
    for (const [k, u] of Object.entries(who)) {
      await totp.ensureEnrolled(u);
      P[k] = await openPage(chrome.cdp);
      if (!(await signIn(P[k], u))) throw new Error(`${k} sign-in failed`);
    }
    await runChecks("delegation.run1", P);
    await runChecks("delegation.run2", P);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("delegation.run", false, String(e.message)))
  .then(() => {
    console.log(`delegation checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
