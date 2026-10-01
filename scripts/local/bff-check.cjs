/* eslint-disable */
/**
 * WP03.2 browser-facing model reads: GET /api/runtime/model-applications[/{id}] through
 * real portal sessions (Keycloak password + TOTP), compared with direct Spring reads and
 * the persisted rows, and with docs/wp03/bee-local-api.openapi.json.
 *
 *   node scripts/local/bff-check.cjs                 (about 30 s; restarts Spring once)
 *   node scripts/local/bff-check.cjs --with-expiry   (npm run local:bff and local:check; waits for the access tokens to near expiry, about 1 minute in total)
 *
 * Runs as disposable twins `test.<persona>` (scripts/local/test-identities.cjs). Every
 * database row it changes belongs to a twin or is a model_application state/version, is
 * saved first and restored in a finally block, and the run fails if any differs after.
 * Spring is stopped once for the outage and planted-value cases and always started again.
 * WP03.3: each case's correlation ID is followed through the structured request logs
 * (Next.js request/upstream/identity lines, Spring request line).
 * Appends JSON lines to $AUTH_RESULTS when set.
 */
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { APPLICATIONS, app } = require("../../local/generate-fixtures.cjs");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const contract = require("./contract-lib.cjs");
const pc = require("./portal-client.cjs");
const logs = require("./request-logs.cjs");
const { WEB, API, call, cid, sameCorr, noStore } = pc;

const env = (k, d) => process.env[k] || d;
const doc = contract.load();
const LIST = "/api/runtime/model-applications";
const DETAIL = "/api/runtime/model-applications/{id}";
const byRef = Object.fromEntries(APPLICATIONS.map((a) => [a.reference, { ...a, id: app(a.n) }]));
const refsOf = (org) => APPLICATIONS.filter((a) => a.org === org).map((a) => a.reference).sort();
const NOVA_REFS = refsOf("NOVA"), PIXEL_REFS = refsOf("PIXEL");
const twin = (p) => ids.name(p);
const acct = (p) => ids.accountId(p);

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(34)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}
const show = (errs) => (errs.length ? `; ${errs.slice(0, 3).join("; ")}` : "");
function sql(statement) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${env("BEE_APP_DB_PASSWORD", "bee-local-app")}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", statement]).toString().trim();
}
const PERSONAS = ["nova.applicant", "pixel.applicant", "iame.officer", "bee.reviewer"];
/** Every row this check may touch, for the before/after comparison. */
function rowState() {
  const twins = PERSONAS.map((p) => `'${acct(p)}'`).join(",");
  return sql(`SELECT concat_ws(' | ',
    (SELECT string_agg(id || ':' || state || ':' || version, ',' ORDER BY id) FROM app.model_application),
    (SELECT string_agg(id || ':' || role || ':' || active || ':' || valid_from || ':' || valid_to, ',' ORDER BY id) FROM app.role_assignment WHERE user_id IN (${twins})),
    (SELECT string_agg(user_id || ':' || organisation_id || ':' || active || ':' || valid_from || ':' || valid_to, ',' ORDER BY user_id, organisation_id) FROM app.organisation_membership WHERE user_id IN (${twins})),
    (SELECT string_agg(id || ':' || stage || ':' || active, ',' ORDER BY id) FROM app.assignment WHERE user_id IN (${twins})))`);
}

const items = (r) => (r.json?.items || []).map((i) => i.reference).sort();
const detail = (jar, id, label = "detail") => call(`${WEB}/api/runtime/model-applications/${id}`, { jar, correlationId: cid(label) });
const list = (jar, label = "list", q = "") => call(`${WEB}${LIST}${q}`, { jar, correlationId: cid(label) });
const springGet = (token, p) => call(`${API}${p}`, { token, correlationId: cid("spring") });
/** True when each pattern matches a line of that layer's trace, in order. */
function follows(t, want) {
  return ["web", "api"].every((layer) => {
    const got = t[layer].map(logs.describe);
    let i = 0;
    for (const re of want[layer] || []) { while (i < got.length && !re.test(got[i])) i++; if (i++ >= got.length) return false; }
    return true;
  });
}
const traced = (t) => `web [${t.web.map(logs.describe).join("; ")}] api [${t.api.map(logs.describe).join("; ")}]`;
const shape = (x) => [x.status, x.text, x.headers.get("content-type"), x.headers.get("content-length"), x.headers.get("cache-control"), [...x.headers.keys()].sort().join()].join("|");

async function main() {
  const before = rowState();
  const m0 = logs.mark();

  /* sign-ins first (one TOTP step per twin), then direct tokens */
  for (const p of PERSONAS) await totp.ensureEnrolled(twin(p));
  const S = {};
  for (const p of PERSONAS) S[p] = await pc.portalSignIn(twin(p));
  check("bff.sign-in", PERSONAS.every((p) => S[p].final?.pathname === "/app" && S[p].jar.has("bee_session")),
    `${PERSONAS.map((p) => `test.${p} -> ${S[p].final?.pathname}`).join(", ")} (real Keycloak password + TOTP)`);
  const T = { nova: await totp.accessToken(twin("nova.applicant")), pixel: await totp.accessToken(twin("pixel.applicant")) };

  /* ---------- no session, forged session, browser bearer injection ---------- */
  const anon = [await list(null, "anon"), await detail(null, byRef["LOCAL-MA-0002"].id, "anon")];
  const forgedJar = () => { const j = new pc.Jar(); j.set(WEB, "bee_session", "forged-" + crypto.randomBytes(16).toString("hex")); return j; };
  const forged = [await list(forgedJar(), "forged"), await detail(forgedJar(), byRef["LOCAL-MA-0002"].id, "forged")];
  const bearer = [await call(`${WEB}${LIST}`, { token: T.nova, correlationId: cid("bearer") }), await call(`${WEB}/api/runtime/model-applications/${byRef["LOCAL-MA-0002"].id}`, { token: T.nova, correlationId: cid("bearer") })];
  const e1 = [...anon, ...forged, ...bearer].flatMap((x, i) => contract.conforms(doc, i % 2 ? DETAIL : LIST, "GET", x));
  check("bff.no-session", [...anon, ...forged, ...bearer].every((x) => x.status === 401 && x.json?.error === "no_session" && sameCorr(x) && noStore(x)) && forged.every((x) => x.setCookie.some((c) => /^bee_session=;/.test(c))) && e1.length === 0,
    `list/detail without cookie ${anon.map((x) => x.status)}, forged cookie ${forged.map((x) => x.status)} (cleared), valid Nova bearer without cookie ${bearer.map((x) => x.status)}: all 401 no_session${show(e1)}`);
  const injected = await call(`${WEB}${LIST}`, { jar: S["pixel.applicant"].jar, token: T.nova, correlationId: cid("inject") });
  check("bff.bearer-injection-ignored", injected.status === 200 && JSON.stringify(items(injected)) === JSON.stringify(PIXEL_REFS),
    `PixelCert session cookie + Nova's bearer token in Authorization: ${injected.status} ${items(injected).join(", ")} (the session decides, the header is ignored)`);

  /* ---------- Nova and PixelCert: BFF equals direct Spring equals the persisted rows ---------- */
  const rows = Object.fromEntries(sql("SELECT id || '|' || state || '|' || version FROM app.model_application").split("\n").map((l) => { const [id, state, version] = l.split("|"); return [id, { state, version: Number(version) }]; }));
  for (const [p, org, refs, token] of [["nova.applicant", "NOVA", NOVA_REFS, T.nova], ["pixel.applicant", "PIXEL", PIXEL_REFS, T.pixel]]) {
    const b = await list(S[p].jar, `${org}-list`);
    const d = await springGet(token, "/api/model-applications");
    const e = contract.conforms(doc, LIST, "GET", b);
    const dbOk = (b.json?.items || []).every((i) => rows[i.id]?.state === i.state && rows[i.id]?.version === i.version);
    check(`bff.${org.toLowerCase()}-list`, b.status === 200 && JSON.stringify(b.json) === JSON.stringify(d.json) && JSON.stringify(items(b)) === JSON.stringify(refs) && dbOk && e.length === 0 && sameCorr(b) && noStore(b),
      `BFF ${b.status} ${items(b).join(", ")}; identical to direct Spring (${d.status}); id/state/version equal the database rows; matches ModelApplicationList${show(e)}`);
    const det = [];
    for (const ref of refs) {
      const bd = await detail(S[p].jar, byRef[ref].id, `${org}-detail`);
      const dd = await springGet(token, `/api/model-applications/${byRef[ref].id}`);
      det.push({ ref, ok: bd.status === 200 && JSON.stringify(bd.json) === JSON.stringify(dd.json) && rows[bd.json?.id]?.version === bd.json?.version && contract.conforms(doc, DETAIL, "GET", bd).length === 0 && sameCorr(bd), v: bd.json?.version, s: bd.json?.state });
    }
    check(`bff.${org.toLowerCase()}-detail`, det.every((x) => x.ok), `${det.map((x) => `${x.ref} ${x.s} v${x.v}`).join(", ")}: BFF detail identical to direct Spring and the database row; matches ModelApplication`);
  }
  const novaList = await list(S["nova.applicant"].jar), pixelList = await list(S["pixel.applicant"].jar);
  const leak = (r, refs) => refs.filter((ref) => r.text.includes(ref) || r.text.includes(byRef[ref].id));
  const cross = [];
  for (const ref of PIXEL_REFS) cross.push(await detail(S["nova.applicant"].jar, byRef[ref].id, "cross"));
  for (const ref of NOVA_REFS) cross.push(await detail(S["pixel.applicant"].jar, byRef[ref].id, "cross"));
  check("bff.organisation-isolation", leak(novaList, PIXEL_REFS).length === 0 && leak(pixelList, NOVA_REFS).length === 0 && !novaList.text.includes("PIXEL") && !pixelList.text.includes("NOVA") && cross.every((x) => x.status === 404 && x.json?.error === "not_found" && !/LOCAL-MA|NOVA|PIXEL/.test(x.text)),
    `Nova list has no PixelCert IDs/refs, PixelCert list has no Nova IDs/refs; ${cross.length} cross-organisation detail reads -> ${[...new Set(cross.map((x) => x.status))]} not_found`);
  const q = await list(S["nova.applicant"].jar, "query", "?organisation=PIXEL&scope=all&id=" + byRef["LOCAL-MA-0003"].id);
  check("bff.query-not-forwarded", q.status === 200 && JSON.stringify(items(q)) === JSON.stringify(NOVA_REFS), `?organisation=PIXEL&scope=all&id=<PixelCert id> -> ${items(q).join(", ")}`);

  /* ---------- officers: assignment and current stage decide, through the BFF ---------- */
  const iame = S["iame.officer"].jar, reviewer = S["bee.reviewer"].jar;
  let r = await list(iame, "iame");
  const unassigned = await detail(iame, byRef["LOCAL-MA-0002"].id, "iame-unassigned");
  check("bff.iame-assigned-only", r.status === 200 && JSON.stringify(items(r)) === '["LOCAL-MA-0003"]' && r.json.items[0].readBasis.join() === "assigned" && unassigned.status === 404,
    `IAME list ${items(r).join(", ")} (assigned); unassigned LOCAL-MA-0002 detail ${unassigned.status}`);
  const rl = await list(reviewer, "reviewer"), rd = await detail(reviewer, byRef["LOCAL-MA-0004"].id, "reviewer");
  check("bff.unassigned-reviewer", rl.status === 200 && rl.json.count === 0 && rd.status === 404, `Reviewer with only an inactive assignment: list count ${rl.json?.count}, LOCAL-MA-0004 detail ${rd.status}`);
  const pid = byRef["LOCAL-MA-0003"].id;
  const origState = sql(`SELECT state FROM app.model_application WHERE id = '${pid}'`);
  let stale, staleList;
  try {
    sql(`UPDATE app.model_application SET state = 'bee_scrutiny' WHERE id = '${pid}'`);
    staleList = await list(iame, "stale");
    stale = await detail(iame, pid, "stale");
  } finally {
    sql(`UPDATE app.model_application SET state = '${origState}' WHERE id = '${pid}'`);
  }
  check("bff.old-stage-officer", staleList.status === 200 && staleList.json.count === 0 && stale.status === 404, `LOCAL-MA-0003 handed off to bee_scrutiny, IAME assignment still active at iame_scrutiny: list count ${staleList.json?.count}, detail ${stale.status} (restored to ${origState})`);

  /* ---------- one indistinguishable 404 ---------- */
  const nf = [
    ["other organisation", await detail(S["nova.applicant"].jar, byRef["LOCAL-MA-0003"].id, "404")],
    ["unknown", await detail(S["nova.applicant"].jar, crypto.randomUUID(), "404")],
    ["malformed reference", await detail(S["nova.applicant"].jar, "LOCAL-MA-0003", "404")],
    ["malformed", await detail(S["nova.applicant"].jar, "1", "404")],
    ["unsafe segment", await detail(S["nova.applicant"].jar, "a%3Bb%20c", "404")],
    ["encoded slash", await detail(S["nova.applicant"].jar, "..%2Fme", "404")],
    ["stale assignment", stale],
    ["unassigned", unassigned],
  ];
  const shapes = new Set(nf.map(([, x]) => shape(x)));
  const nfe = nf.flatMap(([, x]) => contract.conforms(doc, DETAIL, "GET", x));
  check("bff.not-found-indistinguishable", nf.every(([, x]) => x.status === 404 && sameCorr(x)) && shapes.size === 1 && nfe.length === 0,
    `${nf.map(([l, x]) => `${l} ${x.status}`).join(", ")}; ${shapes.size} distinct status/body/header shape(s), correlation ID fresh on each${show(nfe)}`);

  /* ---------- same persisted record and version, after a reversible change ---------- */
  const vid = byRef["LOCAL-MA-0001"].id;
  const origVersion = Number(sql(`SELECT version FROM app.model_application WHERE id = '${vid}'`));
  let bv, dv, dbv;
  try {
    sql(`UPDATE app.model_application SET version = version + 7 WHERE id = '${vid}'`);
    bv = await detail(S["nova.applicant"].jar, vid, "version");
    dv = await springGet(T.nova, `/api/model-applications/${vid}`);
    dbv = Number(sql(`SELECT version FROM app.model_application WHERE id = '${vid}'`));
  } finally {
    sql(`UPDATE app.model_application SET version = ${origVersion} WHERE id = '${vid}'`);
  }
  const bl = await list(S["nova.applicant"].jar, "version-after");
  check("bff.same-record-version", bv.json?.version === origVersion + 7 && dv.json?.version === bv.json?.version && dbv === bv.json?.version && bv.json?.id === vid && bl.json.items.find((i) => i.id === vid)?.version === origVersion,
    `LOCAL-MA-0001 version ${origVersion} -> ${dbv} in the database: BFF v${bv.json?.version}, direct Spring v${dv.json?.version}; restored, BFF list shows v${bl.json?.items?.find((i) => i.id === vid)?.version}`);

  /* ---------- database changes after sign-in take effect at the next read ---------- */
  const nova = S["nova.applicant"].jar, nid = byRef["LOCAL-MA-0002"].id, novaAcct = acct("nova.applicant");
  const roles = sql(`SELECT id || ':' || active FROM app.role_assignment WHERE user_id = '${novaAcct}'`).split("\n");
  let rev;
  try {
    sql(`UPDATE app.role_assignment SET active = false WHERE user_id = '${novaAcct}'`);
    rev = { l: await list(nova, "revoked"), d: await detail(nova, nid, "revoked"), m: await call(`${WEB}/api/runtime/me`, { jar: nova, correlationId: cid("revoked") }), s: await springGet(T.nova, "/api/model-applications") };
  } finally {
    for (const row of roles) { const [id, active] = row.split(":"); sql(`UPDATE app.role_assignment SET active = ${active === "true"} WHERE id = '${id}'`); }
  }
  const back = await list(nova, "restored");
  const re2 = [...contract.conforms(doc, LIST, "GET", rev.l), ...contract.conforms(doc, DETAIL, "GET", rev.d), ...contract.conforms(doc, "/api/runtime/me", "GET", rev.m), ...contract.conforms(doc, "/api/model-applications", "GET", rev.s)];
  check("bff.role-revoked-after-sign-in", re2.length === 0 && [rev.l, rev.d, rev.m].every((x) => x.status === 403 && x.json?.error === "no_effective_role" && !/LOCAL-MA/.test(x.text)) && rev.s.json?.error === "no_effective_role" && back.status === 200 && back.json.count === 3,
    `role deactivated in bee_app during a live session: BFF list ${rev.l.status} ${rev.l.json?.error}, detail ${rev.d.status} ${rev.d.json?.error}, /api/runtime/me ${rev.m.status} ${rev.m.json?.error} (direct Spring the same); restored: list ${back.status} count ${back.json?.count}, session kept${show(re2)}`);
  const mem = sql(`SELECT organisation_id || '|' || active || '|' || valid_to FROM app.organisation_membership WHERE user_id = '${novaAcct}'`).split("\n");
  let exp;
  try {
    sql(`UPDATE app.organisation_membership SET valid_to = now() - interval '1 day' WHERE user_id = '${novaAcct}'`);
    exp = { l: await list(nova, "expired"), d: await detail(nova, nid, "expired"), s: await springGet(T.nova, "/api/model-applications"), sd: await springGet(T.nova, `/api/model-applications/${nid}`) };
  } finally {
    for (const row of mem) { const [org, active, validTo] = row.split("|"); sql(`UPDATE app.organisation_membership SET active = ${active === "true"}, valid_to = '${validTo}' WHERE user_id = '${novaAcct}' AND organisation_id = '${org}'`); }
  }
  const e3 = [...contract.conforms(doc, LIST, "GET", exp.l), ...contract.conforms(doc, DETAIL, "GET", exp.d), ...contract.conforms(doc, "/api/model-applications", "GET", exp.s), ...contract.conforms(doc, "/api/model-applications/{id}", "GET", exp.sd)];
  check("bff.expired-membership", [exp.l, exp.d, exp.s, exp.sd].every((x) => x.status === 403 && x.json?.error === "no_read_scope" && !/LOCAL-MA/.test(x.text)) && e3.length === 0,
    `membership valid_to in the past: BFF list ${exp.l.status} ${exp.l.json?.error}, detail ${exp.d.status} ${exp.d.json?.error}; direct Spring list ${exp.s.status} ${exp.s.json?.error}, detail ${exp.sd.status} ${exp.sd.json?.error}; restored${show(e3)}`);

  /* ---------- draft writes vs unsupported methods (WP05.1b) ---------- */
  const snap = sql("SELECT string_agg(id || ':' || state || ':' || version, ',' ORDER BY id) FROM app.model_application");
  const feeId = byRef["LOCAL-MA-0002"].id;
  const badCreate = await call(`${WEB}${LIST}`, { method: "POST", jar: nova, correlationId: cid("write"), headers: { Origin: WEB, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replace(/-/g, "").slice(0, 24) }, body: JSON.stringify({ state: "approved", version: 99 }) });
  const badPatch = await call(`${WEB}/api/runtime/model-applications/${feeId}`, { method: "PATCH", jar: nova, correlationId: cid("write-fee"), headers: { Origin: WEB, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replace(/-/g, "").slice(0, 24) }, body: JSON.stringify({ version: 0, category: "RAC", modelNumber: "X" }) });
  const blocked = [];
  for (const m of ["PUT", "DELETE"]) for (const p of [LIST, `/api/runtime/model-applications/${nid}`]) {
    blocked.push(await call(`${WEB}${p}`, { method: m, jar: nova, correlationId: cid("write"), headers: { Origin: WEB, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ state: "approved" }) }));
  }
  blocked.push(await call(`${WEB}/api/runtime/model-applications/${nid}`, { method: "POST", jar: nova, correlationId: cid("write-post-detail"), headers: { Origin: WEB, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID().replace(/-/g, "").slice(0, 24) }, body: "{}" }));
  check("bff.draft-write-guards",
    badCreate.status === 422 && badCreate.json?.error === "validation_failed" &&
    badPatch.status === 403 && badPatch.json?.error === "not_editable" &&
    blocked.every((x) => x.status === 405 && x.json?.error === "method_not_allowed" && x.headers.get("allow") && sameCorr(x)) &&
    snap === sql("SELECT string_agg(id || ':' || state || ':' || version, ',' ORDER BY id) FROM app.model_application"),
    `invalid POST create -> ${badCreate.status} ${badCreate.json?.error}; PATCH fee_due -> ${badPatch.status} ${badPatch.json?.error}; PUT/DELETE/POST detail -> ${blocked.length} x 405; no row changed`);
  for (const [route, x] of [[LIST, blocked[0]], [DETAIL, blocked[blocked.length - 1]]]) {
    const errVal = contract.validate(doc.components.schemas.Error, x.json, doc);
    contract.record({ route, method: "GET", status: 405, code: "method_not_allowed", ok: x.status === 405 && x.json?.error === "method_not_allowed" && errVal.length === 0 && sameCorr(x) && noStore(x) });
  }

  /* ---------- Spring outage, planted values via a stand-in, restart ---------- */
  const realList = (await springGet(T.nova, "/api/model-applications")).json;
  const realApp = (await springGet(T.nova, `/api/model-applications/${nid}`)).json;
  const beforeOutage = await list(nova, "before-outage");
  const SECRET = `planted-secret-${crypto.randomBytes(6).toString("hex")}`;
  const SQL = `ERROR: column "password_hash" of relation "app.user_account"; SELECT password_hash FROM app.user_account WHERE marker='${crypto.randomBytes(4).toString("hex")}' -- at gov.bee.api.Repo`;
  const PLANTED = [SECRET, SQL, encodeURIComponent(SQL), "password_hash", SQL.slice(-30)];
  const json = (status, body) => ({ status, type: "application/json", text: JSON.stringify(body) });
  const cases = [
    ["list top-level secret", LIST, json(200, { ...realList, secretToken: SECRET }), 502, "invalid_api_response"],
    ["list item secret", LIST, json(200, { ...realList, items: realList.items.map((i, k) => (k === 1 ? { ...i, owner: { apiKey: SECRET } } : i)) }), 502, "invalid_api_response"],
    ["list count mismatch", LIST, json(200, { ...realList, count: realList.count + 1 }), 502, "invalid_api_response"],
    ["detail top-level secret", DETAIL, json(200, { ...realApp, secretToken: SECRET }), 502, "invalid_api_response"],
    ["detail nested secret", DETAIL, json(200, { ...realApp, readBasis: ["own-org", { token: SECRET }] }), 502, "invalid_api_response"],
    ["detail SQL 404 code", DETAIL, json(404, { error: SQL, message: SQL }), 502, "api_error"],
    ["list SQL 403 detail", LIST, json(403, { error: "denied_by_default", message: SQL }), 502, "api_error"],
    ["detail 500 with SQL", DETAIL, json(500, { error: "internal_error", message: SQL, trace: SQL }), 502, "api_error"],
    ["detail non-JSON", DETAIL, { status: 200, type: "text/html", text: `<html>${SQL} ${SECRET}</html>` }, 502, "invalid_api_response"],
  ];
  const seen = [];
  let current = null;
  const fake = http.createServer((req, res) => {
    seen.push({ path: req.url, correlationId: req.headers["x-correlation-id"], bearer: /^Bearer \S+$/.test(req.headers.authorization || "") });
    const c = current || json(503, { error: "service_unavailable" });
    res.writeHead(c.status, { "Content-Type": c.type, ...(req.headers["x-correlation-id"] ? { "X-Correlation-Id": req.headers["x-correlation-id"] } : {}) });
    res.end(c.text);
  });
  const outcome = [];
  let down, session, after;
  try {
    pc.runtime("stop_api");
    down = [await list(nova, "down"), await detail(nova, nid, "down")];
    session = await call(`${WEB}/api/auth/session`, { jar: nova });
    await new Promise((ok, ko) => fake.once("error", ko).listen(Number(env("BEE_API_PORT", "8090")), "127.0.0.1", ok));
    try {
      for (const [label, op, answer, status, code] of cases) {
        current = answer;
        const x = op === LIST ? await list(nova, "planted") : await detail(nova, nid, "planted");
        outcome.push({ label, op, x, status, code, upstream: seen.some((s) => s.correlationId === x.sent && s.bearer) });
      }
    } finally {
      fake.closeAllConnections();
      await new Promise((ok) => fake.close(() => ok()));
    }
  } finally {
    pc.runtime("start_api");
  }
  after = await list(nova, "after-outage");
  const de = down.flatMap((x, i) => contract.conforms(doc, i ? DETAIL : LIST, "GET", x));
  check("bff.spring-outage", down.every((x) => x.status === 503 && x.json?.error === "api_unreachable" && sameCorr(x)) && session.json?.authenticated === true && after.status === 200 && JSON.stringify(after.json) === JSON.stringify(beforeOutage.json) && de.length === 0,
    `Spring stopped: list ${down[0].status} ${down[0].json?.error}, detail ${down[1].status}; session kept; Spring restarted: list ${after.status}, identical to before${show(de)}`);
  const pe = outcome.flatMap((o) => contract.conforms(doc, o.op, "GET", o.x));
  const bad = outcome.filter((o) => !(o.x.status === o.status && o.x.json?.error === o.code && sameCorr(o.x) && o.upstream));
  check("bff.planted-values-rejected", bad.length === 0 && pe.length === 0,
    `${outcome.map((o) => `${o.label} -> ${o.x.status} ${o.x.json?.error}`).join("; ")}; correlation echoed and seen by the stand-in with the session's bearer${bad.length ? `; wrong: ${bad.map((o) => o.label).join(", ")}` : ""}${show(pe)}`);
  const allLogs = logs.allText(m0);
  const inPortal = PLANTED.filter((v) => pc.portalSeen.some((t) => t.includes(v)));
  const inLogs = PLANTED.filter((v) => allLogs.includes(v));
  const tokensInLogs = Object.values(T).some((t) => allLogs.includes(t.slice(-40)));
  check("bff.planted-values-contained", inPortal.length === 0 && inLogs.length === 0 && !tokensInLogs,
    `planted secret and SQL text in ${pc.portalSeen.length} portal responses (bodies, headers, Location): ${inPortal.length ? "FOUND" : "none"}; in structured and console logs: ${inLogs.length ? "FOUND" : "none"}; tokens in logs: ${tokensInLogs ? "FOUND" : "none"}`);

  /* ---------- one correlation ID per case, browser -> Next.js -> Spring ---------- */
  const esc = (r) => r.replace(/[{}]/g, "\\$&");
  const both = (route, sroute, status, outcome) => ({ web: [new RegExp(`^upstream GET ${esc(sroute)} ${status} ${outcome}$`), new RegExp(`^request GET ${esc(route)} ${status} ${outcome}$`)], api: [new RegExp(`^request GET ${esc(sroute)} ${status} ${outcome}$`)] });
  const cor = [];
  const expect = (label, x, want, extra = () => true) => { const t = logs.trace(x?.sent, m0); cor.push({ label, ok: !!x?.sent && follows(t, want) && extra(t), t }); };
  expect("list read", after, both(LIST, "/api/model-applications", 200, "ok"));
  expect("detail read", bv, both(DETAIL, "/api/model-applications/{id}", 200, "ok"));
  expect("role denial", rev.l, both(LIST, "/api/model-applications", 403, "no_effective_role"));
  expect("scope denial", exp.d, both(DETAIL, "/api/model-applications/{id}", 403, "no_read_scope"));
  expect("other organisation", nf[0][1], both(DETAIL, "/api/model-applications/{id}", 404, "not_found"));
  expect("malformed ID", nf[3][1], both(DETAIL, "/api/model-applications/{id}", 404, "not_found"));
  expect("unsafe segment", nf[4][1], both(DETAIL, "/api/model-applications/{id}", 404, "not_found"));
  expect("no session", anon[0], { web: [/^request GET \/api\/runtime\/model-applications 401 no_session$/] }, (t) => t.web.length === 1 && t.api.length === 0);
  expect("outage", down[0], { web: [/^upstream GET \/api\/model-applications 503 api_unreachable$/, /^request GET \/api\/runtime\/model-applications 503 api_unreachable$/] }, (t) => t.api.length === 0);
  expect("invalid create", badCreate, { web: [/^request POST \/api\/runtime\/model-applications 422 validation_failed$/] }, (t) => t.api.length === 1);
  expect("unsupported method", blocked[0], { web: [/^request PUT \/api\/runtime\/model-applications 405 method_not_allowed$/] }, (t) => t.api.length === 0);
  check("bff.correlation", cor.every((c) => c.ok), cor.map((c) => `${c.label}: ${c.ok ? "ok" : "MISSING " + traced(c.t)}`).join("; "));

  /* ---------- expiry: refresh keeps a live session, a refused refresh ends it (opt-in, waits for token expiry) ---------- */
  if (process.argv.includes("--with-expiry")) {
    const view = async (p) => (await call(`${WEB}/api/auth/session`, { jar: S[p].jar })).json;
    const novaBefore = await view("nova.applicant");
    const expiries = await Promise.all(["nova.applicant", "pixel.applicant", "iame.officer", "bee.reviewer"].map(async (p) => new Date((await view(p)).accessExpiresAt).getTime()));
    await totp.logoutUser(twin("pixel.applicant"));
    await totp.logoutUser(twin("iame.officer"));
    await totp.logoutUser(twin("bee.reviewer"));
    const waitMs = Math.max(0, Math.max(...expiries) - Date.now() - 10_000);
    console.log(`     waiting ${Math.round(waitMs / 1000)} s for the access tokens to near expiry...`);
    await new Promise((ok) => setTimeout(ok, waitMs));
    const nl = await list(nova, "refresh"), nd = await detail(nova, nid, "refresh");
    const novaAfter = await view("nova.applicant");
    const gone = [await list(S["pixel.applicant"].jar, "expired"), await detail(S["iame.officer"].jar, byRef["LOCAL-MA-0003"].id, "expired"), await call(`${WEB}/api/runtime/me`, { jar: S["bee.reviewer"].jar, correlationId: cid("expired") })];
    const again = await list(S["pixel.applicant"].jar, "expired-again");
    const xe = [...contract.conforms(doc, LIST, "GET", nl), ...contract.conforms(doc, DETAIL, "GET", nd), ...gone.flatMap((x, i) => contract.conforms(doc, [LIST, DETAIL, "/api/runtime/me"][i], "GET", x))];
    check("bff.refresh", nl.status === 200 && nd.status === 200 && novaAfter.refreshCount > novaBefore.refreshCount && novaAfter.accessExpiresAt > novaBefore.accessExpiresAt,
      `access token near expiry: BFF list ${nl.status}, detail ${nd.status}; refreshCount ${novaBefore.refreshCount} -> ${novaAfter.refreshCount}`);
    const rt = logs.trace(nl.sent, m0), gt = logs.trace(gone[0].sent, m0);
    const refreshOk = follows(rt, { web: [/^identity token\.refresh 200 ok$/, /^upstream GET \/api\/model-applications 200 ok$/, /^request GET \/api\/runtime\/model-applications 200 ok$/], api: [/^request GET \/api\/model-applications 200 ok$/] });
    const refusedOk = follows(gt, { web: [/^identity token\.refresh 400 invalid_grant$/, /^request GET \/api\/runtime\/model-applications 401 session_expired$/] }) && !gt.web.some((l) => l.event === "upstream") && gt.api.length === 0;
    check("bff.correlation-refresh", refreshOk && refusedOk, `refresh: ${traced(rt)}; refused refresh: ${traced(gt)} (Keycloak calls logged by the portal with the request's ID; the ID is not sent to Keycloak)`);
    check("bff.expired-session", gone.every((x) => x.status === 401 && x.json?.error === "session_expired" && sameCorr(x) && x.setCookie.some((c) => /^bee_session=;/.test(c))) && again.status === 401 && again.json?.error === "no_session" && xe.length === 0,
      `Keycloak sessions ended by admin, refresh refused: PixelCert list ${gone[0].status} ${gone[0].json?.error}, IAME detail ${gone[1].status} ${gone[1].json?.error}, reviewer /api/runtime/me ${gone[2].status} ${gone[2].json?.error}, cookies cleared; next request ${again.status} ${again.json?.error}${show(xe)}`);
  }

  for (const p of PERSONAS) await call(`${WEB}/api/auth/logout`, { method: "POST", jar: S[p].jar, headers: { Origin: WEB } });
  const problems = logs.problems(m0), n = logs.count(m0);
  check("bff.log-format", problems.length === 0 && n.api > 20 && n.web > 40, `${n.api} Spring and ${n.web} Next.js structured lines since this run, each valid against docs/wp03/request-log.schema.json${show(problems)}`);
  const afterRows = rowState();
  check("bff.rows-restored", afterRows === before, `model_application state/version and the twins' role, membership and assignment rows ${afterRows === before ? "identical" : "DIFFER"} before and after`);
}

if (require.main === module) (async () => {
  await ids.withIdentities("test", main);
})()
  .catch((e) => check("bff.run", false, `aborted: ${e.message}`))
  .then(async () => {
    for (const p of PERSONAS) await totp.logoutUser(twin(p)).catch(() => {});
    console.log(`bff checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
