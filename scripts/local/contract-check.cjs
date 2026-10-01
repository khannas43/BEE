/* eslint-disable */
/**
 * WP03.1 cross-layer contract checks: live Spring (direct, as Next's server code calls it)
 * and live Next.js routes (as a browser calls them) compared with
 * docs/wp03/bee-local-api.openapi.json.
 *
 *   node scripts/local/contract-check.cjs     (about 1-2 minutes; restarts Spring once)
 *
 * Runs as disposable twins `test.<persona>` (scripts/local/test-identities.cjs). The
 * missing-MFA token comes from a temporary Keycloak client without the amr mapper,
 * deleted in a finally block. The upstream-unavailable case stops the local Spring API
 * and starts it again. Appends JSON lines to $AUTH_RESULTS when set.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { app } = require("../../local/generate-fixtures.cjs");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const contract = require("./contract-lib.cjs");

const env = (k, d) => process.env[k] || d;
const ROOT = path.join(__dirname, "../..");
const WEB = `http://127.0.0.1:${env("BEE_WEB_PORT", "3100")}`;
const API = `http://127.0.0.1:${env("BEE_API_PORT", "8090")}`;
const ISSUER = `http://127.0.0.1:${env("BEE_KC_PORT", "8180")}/realms/${env("BEE_REALM", "bee-local")}`;
const LOG_DIR = path.join(ROOT, ".local/logs");
const NO_AMR_CLIENT = "bee-contract-no-amr";
const NOVA_APP = app(2), PIXEL_APP = app(3);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const doc = contract.load();
let realMe = null;

/* ---------- stand-in for Spring on its port while Spring is stopped: planted values ---------- */
const PLANTED_SECRET = `planted-secret-${crypto.randomBytes(6).toString("hex")}`;
const PLANTED_SQL = `ERROR: relation "app.user_account" does not exist; SELECT password_hash FROM app.user_account WHERE marker='${crypto.randomBytes(4).toString("hex")}' -- at gov.bee.api.Repo`;
const PLANTED = [PLANTED_SECRET, PLANTED_SQL, encodeURIComponent(PLANTED_SQL), "password_hash", "SELECT password", PLANTED_SQL.slice(-30)];
function standIn() {
  const seen = [];
  let mode = "extra-field";
  const server = http.createServer((req, res) => {
    const id = req.headers["x-correlation-id"];
    seen.push({ mode, path: req.url, correlationId: id, bearer: /^Bearer \S+$/.test(req.headers.authorization || "") });
    const [status, body] = mode === "extra-field" ? [200, { ...realMe, secretToken: PLANTED_SECRET }] : [403, { error: PLANTED_SQL, message: PLANTED_SQL }];
    res.writeHead(status, { "Content-Type": "application/json", ...(id ? { "X-Correlation-Id": id } : {}) });
    res.end(JSON.stringify(body));
  });
  return {
    seen,
    set: (m) => { mode = m; },
    listen: () => new Promise((ok, ko) => server.once("error", ko).listen(Number(env("BEE_API_PORT", "8090")), "127.0.0.1", ok)),
    close: () => new Promise((ok) => { server.closeAllConnections(); server.close(() => ok()); }),
  };
}

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(34)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}
const cid = (label) => `wp031-${label}-${crypto.randomBytes(4).toString("hex")}`;
const show = (errs) => (errs.length ? `; ${errs.slice(0, 3).join("; ")}` : "");

/* ---------- HTTP with an optional cookie jar; every error body is kept for the leak scan ---------- */
const errorBodies = [];
/** Everything the portal sent back (body and Location), for the planted-value scan. */
const webSeen = [];
const secrets = new Set();
class Jar {
  constructor() { this.c = new Map(); }
  header(url) { const h = new URL(url).hostname; return [...this.c].filter(([k]) => k.startsWith(h + "|")).map(([k, v]) => `${k.split("|")[1]}=${v}`).join("; "); }
  store(url, res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const i = pair.indexOf("="), key = `${new URL(url).hostname}|${pair.slice(0, i)}`, value = pair.slice(i + 1);
      if (!value || attrs.some((a) => /^max-age=0$/i.test(a))) this.c.delete(key); else this.c.set(key, value);
    }
  }
  has(name) { return [...this.c.keys()].some((k) => k.endsWith(`|${name}`)); }
}
async function call(url, { method = "GET", token, jar, correlationId, headers = {}, body } = {}) {
  const h = { Accept: "application/json", ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (correlationId !== undefined) h["X-Correlation-Id"] = correlationId;
  const cookie = jar?.header(url);
  if (cookie) h.Cookie = cookie;
  const res = await fetch(url, { method, headers: h, body, redirect: "manual", signal: AbortSignal.timeout(20000) });
  jar?.store(url, res);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const out = { status: res.status, headers: res.headers, text, body: text, json, location: res.headers.get("location"), sent: correlationId };
  if (url.startsWith(WEB)) webSeen.push(`${res.status} ${url}\n${out.location || ""}\n${[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${text}`);
  if (res.status >= 400 && (url.startsWith(WEB) || url.startsWith(API)) && !url.includes("/health")) errorBodies.push({ url, status: res.status, text });
  return out;
}
const corr = (r) => r.headers.get("x-correlation-id");
const noStore = (r) => /no-store/.test(r.headers.get("cache-control") || "");
const sameCorr = (r) => corr(r) === r.sent;

/* ---------- logs ---------- */
const logSize = (f) => { try { return fs.statSync(path.join(LOG_DIR, f)).size; } catch { return 0; } };
const logSince = (f, from) => { try { return fs.readFileSync(path.join(LOG_DIR, f)).subarray(from).toString("utf8"); } catch { return ""; } };
const accessLine = (log, id) => log.split("\n").find((l) => l.includes(`correlationId=${id} `)) || "";
const runtime = (fn) => execFileSync("bash", ["-c", `source "${ROOT}/scripts/local/lib.sh"; ${fn}`], { stdio: ["ignore", "pipe", "pipe"], timeout: 180000 }).toString();

/* ---------- Keycloak: tokens and a temporary client without the amr mapper ---------- */
async function deleteNoAmrClient() {
  for (const c of await totp.admin(`/clients?clientId=${NO_AMR_CLIENT}`)) await totp.admin(`/clients/${c.id}`, { method: "DELETE" });
}
async function tokenWithoutAmr(u) {
  await deleteNoAmrClient();
  await totp.admin("/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    clientId: NO_AMR_CLIENT, publicClient: true, directAccessGrantsEnabled: true, standardFlowEnabled: false,
    description: "WP03.1 contract-check only; deleted after the run",
    protocolMappers: [{ name: "bee-api-audience", protocol: "openid-connect", protocolMapper: "oidc-audience-mapper", config: { "included.custom.audience": "bee-api", "access.token.claim": "true", "id.token.claim": "false" } }],
  }) });
  await totp.ensureEnrolled(u);
  const r = await fetch(`${ISSUER}/protocol/openid-connect/token`, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: NO_AMR_CLIENT, username: u, password: env("BEE_DEV_USER_PASSWORD", "bee-local-dev"), totp: await totp.nextCode(u) }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`no token from ${NO_AMR_CLIENT}: ${j.error}`);
  return j.access_token;
}
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));

async function portalSignIn(u, jar = new Jar()) {
  const r1 = await call(`${WEB}/api/auth/login?returnTo=/app`, { jar, correlationId: cid("login") });
  const first = await call(r1.location, { jar });
  const done = await totp.completeLogin((url, init = {}) => call(url, { ...init, jar }), first, u);
  const cb = done.location?.startsWith(`${WEB}/api/auth/callback`) ? await call(done.location, { jar, correlationId: cid("callback") }) : null;
  return { jar, login: r1, cb, final: cb?.location ? new URL(cb.location, WEB) : null };
}

/* ---------- inventory: code routes against contract paths ---------- */
function inventory() {
  const browser = Object.entries(doc.paths).filter(([, p]) => p["x-bee-audience"] === "browser");
  const internal = Object.entries(doc.paths).filter(([, p]) => p["x-bee-audience"] === "internal");
  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  const routes = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name === "route.ts") routes.push(f); } };
  walk(path.join(ROOT, "app/api"));
  const problems = [];
  const codeRoutes = {};
  for (const f of routes) {
    const route = "/" + path.relative(path.join(ROOT, "app"), path.dirname(f)).split(path.sep).join("/").replace(/\[(\w+)\]/g, "{$1}");
    const src = fs.readFileSync(f, "utf8");
    const handled = METHODS.filter((m) => new RegExp(`export (async )?function ${m}\\b`).test(src));
    const declared = METHODS.filter((m) => new RegExp(`export const ${m}\\b`).test(src));
    codeRoutes[route] = { handled, declared };
    if (/\[\.\.\./.test(route)) {
      if (doc["x-bee-unmatched"]?.browser?.route !== route) problems.push(`${route} not described in x-bee-unmatched`);
      continue;
    }
    const p = doc.paths[route];
    if (!p || p["x-bee-audience"] !== "browser") { problems.push(`${route} not a browser path in the contract`); continue; }
    const want = METHODS.filter((m) => p[m.toLowerCase()]);
    if (handled.join() !== want.join()) problems.push(`${route} handles ${handled} but contract has ${want}`);
    const missing405 = METHODS.filter((m) => !handled.includes(m) && !declared.includes(m));
    if (missing405.length) problems.push(`${route} has no 405 handler for ${missing405}`);
  }
  for (const [route] of browser) if (!codeRoutes[route]) problems.push(`contract path ${route} has no route.ts`);

  const java = [];
  const walkJ = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walkJ(f); else if (f.endsWith(".java")) java.push(fs.readFileSync(f, "utf8")); } };
  walkJ(path.join(ROOT, "backend/src/main/java"));
  const mappings = new Set();
  for (const src of java) {
    if (/@(Post|Put|Patch|Delete)Mapping|@RequestMapping/.test(src)) problems.push("Spring maps a non-GET handler");
    for (const m of src.matchAll(/@GetMapping\("([^"]+)"\)/g)) mappings.add(m[1]);
  }
  const security = fs.readFileSync(path.join(ROOT, "backend/src/main/java/gov/bee/api/security/SecurityConfig.java"), "utf8");
  const allowed = [...security.matchAll(/requestMatchers\(HttpMethod\.(\w+), ([^)]+)\)/g)].flatMap((m) => [...m[2].matchAll(/"([^"]+)"/g)].map((x) => `${m[1]} ${x[1]}`));
  const internalPaths = internal.map(([r]) => r).sort();
  const springPaths = [...mappings, "/actuator/health"].sort();
  if (springPaths.join() !== internalPaths.join()) problems.push(`Spring GET mappings ${springPaths} vs contract ${internalPaths}`);
  const expectAllowed = ["GET /actuator/health", "GET /actuator/health/**", "GET /api/me", "GET /api/model-applications", "GET /api/model-applications/*"];
  if (allowed.sort().join() !== expectAllowed.sort().join()) problems.push(`SecurityConfig matchers changed: ${allowed}`);
  for (const [r, p] of internal) for (const m of METHODS.filter((x) => x !== "GET")) if (p[m.toLowerCase()]) problems.push(`contract claims ${m} ${r}`);
  check("contract.inventory", problems.length === 0,
    `${routes.length} Next route files vs ${browser.length} browser paths + catch-all; ${springPaths.length} Spring GET routes vs ${internalPaths.length} internal paths; SecurityConfig matchers unchanged (${allowed.length})${show(problems)}`);
  check("contract.deferred-not-operational", doc["x-bee-deferred"].length >= 5 && doc["x-bee-deferred"].every((d) => d.owner && d.status !== "operational"),
    `${doc["x-bee-deferred"].length} deferred routes with owners (${[...new Set(doc["x-bee-deferred"].map((d) => d.owner))].join(", ")}); none operational`);
}

async function springChecks(nova, inactive, noAmr) {
  const R = "/api/model-applications/{id}";
  let r = await call(`${API}/api/model-applications/${NOVA_APP}`, { token: nova, correlationId: cid("spring-read") });
  let e = contract.conforms(doc, R, "GET", r);
  check("spring.nova-read", r.status === 200 && r.json?.reference === "LOCAL-MA-0002" && e.length === 0 && sameCorr(r) && noStore(r),
    `GET ${R} as test.nova.applicant: HTTP ${r.status} ${r.json?.reference} ${r.json?.state}; matches ModelApplication; correlation echoed; no-store${show(e)}`);
  const readId = r.sent;
  r = await call(`${API}/api/model-applications`, { token: nova, correlationId: cid("spring-list") });
  e = contract.conforms(doc, "/api/model-applications", "GET", r);
  check("spring.nova-list", r.status === 200 && r.json?.count === 3 && e.length === 0 && sameCorr(r), `HTTP ${r.status} count=${r.json?.count}; matches ModelApplicationList${show(e)}`);
  r = await call(`${API}/api/me`, { token: nova, correlationId: cid("spring-me") });
  e = contract.conforms(doc, "/api/me", "GET", r);
  realMe = r.json;
  check("spring.nova-me", r.status === 200 && r.json?.authority === "spring-database" && e.length === 0 && sameCorr(r), `HTTP ${r.status} orgs=${r.json?.organisations?.map((o) => o.code)}; matches Me${show(e)}`);

  const cases = [["other organisation", PIXEL_APP], ["unknown", crypto.randomUUID()], ["malformed reference", "LOCAL-MA-0003"], ["malformed", "1"]];
  const seen = [];
  for (const [label, id] of cases) {
    const x = await call(`${API}/api/model-applications/${id}`, { token: nova, correlationId: cid("spring-404") });
    seen.push({ label, x, e: contract.conforms(doc, R, "GET", x), shape: [x.status, x.text, x.headers.get("content-type"), x.headers.get("content-length"), [...x.headers.keys()].sort().join()].join("|") });
  }
  const shapes = new Set(seen.map((s) => s.shape));
  check("spring.not-found-indistinguishable", seen.every((s) => s.x.status === 404 && s.e.length === 0 && sameCorr(s.x)) && shapes.size === 1,
    `${seen.map((s) => `${s.label} ${s.x.status}`).join(", ")}; ${shapes.size} distinct status/body/header shape(s); body ${seen[0].x.text}${show(seen.flatMap((s) => s.e))}`);

  const noTok = [];
  for (const p of ["/api/me", "/api/model-applications", `/api/model-applications/${NOVA_APP}`]) {
    const x = await call(`${API}${p}`, { correlationId: cid("spring-401") });
    noTok.push({ p, x, e: contract.conforms(doc, p.startsWith("/api/model-applications/") ? R : p, "GET", x) });
  }
  check("spring.no-token", noTok.every((n) => n.x.status === 401 && n.x.json?.error === "unauthenticated" && n.e.length === 0 && sameCorr(n.x) && noStore(n.x)),
    `${noTok.map((n) => `${n.p.replace(NOVA_APP, "{id}")} ${n.x.status} ${n.x.json?.error}`).join(", ")}; correlation echoed${show(noTok.flatMap((n) => n.e))}`);

  const amr = claims(noAmr).amr;
  const mfa = [];
  for (const [p, op] of [["/api/me", "/api/me"], ["/api/model-applications", "/api/model-applications"], [`/api/model-applications/${PIXEL_APP}`, R]]) {
    const x = await call(`${API}${p}`, { token: noAmr, correlationId: cid("spring-mfa") });
    mfa.push({ p, x, e: contract.conforms(doc, op, "GET", x) });
  }
  check("spring.missing-mfa", amr === undefined && mfa.every((m) => m.x.status === 403 && m.x.json?.error === "mfa_required" && m.e.length === 0 && sameCorr(m.x)),
    `token from ${NO_AMR_CLIENT} (password+OTP, no amr claim): ${mfa.map((m) => `${m.p.replace(PIXEL_APP, "{id}")} ${m.x.status} ${m.x.json?.error}`).join(", ")}${show(mfa.flatMap((m) => m.e))}`);

  const ina = [];
  for (const [p, op] of [["/api/me", "/api/me"], ["/api/model-applications", "/api/model-applications"]]) {
    const x = await call(`${API}${p}`, { token: inactive, correlationId: cid("spring-inactive") });
    ina.push({ p, x, e: contract.conforms(doc, op, "GET", x) });
  }
  check("spring.inactive-role", ina.every((m) => m.x.status === 403 && m.x.json?.error === "no_effective_role" && m.e.length === 0 && sameCorr(m.x)),
    `test.inactive.role: ${ina.map((m) => `${m.p} ${m.x.status} ${m.x.json?.error}`).join(", ")}${show(ina.flatMap((m) => m.e))}`);

  const writes = [["POST", "/api/model-applications"], ["PUT", `/api/model-applications/${NOVA_APP}`], ["PATCH", `/api/model-applications/${NOVA_APP}`], ["DELETE", `/api/model-applications/${NOVA_APP}`],
    ["POST", `/api/model-applications/${NOVA_APP}/submit`], ["GET", `/api/model-applications/${NOVA_APP}/history`], ["POST", "/api/me"], ["GET", "/actuator/env"]];
  const denied = [];
  for (const [m, p] of writes) {
    const x = await call(`${API}${p}`, { method: m, token: nova, correlationId: cid("spring-write"), headers: { "Content-Type": "application/json" }, body: m === "GET" ? undefined : "{}" });
    denied.push({ m, p, x, e: contract.validate(doc.components.schemas.Error, x.json, doc) });
  }
  const want = JSON.stringify({ error: "denied_by_default", message: doc["x-bee-error-codes"].denied_by_default.message });
  const anon = await call(`${API}/api/model-applications`, { method: "POST", correlationId: cid("spring-write-anon"), body: "{}", headers: { "Content-Type": "application/json" } });
  check("spring.denied-write", denied.every((d) => d.x.status === 403 && d.x.text === want && d.e.length === 0 && sameCorr(d.x) && noStore(d.x)) && anon.status === 401 && anon.json?.error === "unauthenticated",
    `${denied.length} unmapped methods/paths with Nova token -> ${[...new Set(denied.map((d) => `${d.x.status} ${d.x.json?.error}`))].join(", ")} (incl. history, submit, actuator/env); without token POST -> ${anon.status} ${anon.json?.error}`);

  const bad = ["has space", "x".repeat(65), "a;b", "é", "../x"];
  const repl = [];
  for (const b of bad) {
    for (const t of [nova, undefined]) {
      const x = await fetch(`${API}/api/me`, { headers: { "X-Correlation-Id": b, ...(t ? { Authorization: `Bearer ${t}` } : {}) } });
      repl.push(x.headers.get("x-correlation-id"));
    }
  }
  check("spring.correlation-unsafe-replaced", repl.every((x) => UUID_RE.test(x || "")) && new Set(repl).size === repl.length,
    `${bad.length} unsafe values x (200, 401): each replaced by a fresh UUID`);
  return readId;
}

async function nextChecks(jar, novaToken) {
  let r = await call(`${WEB}/api/runtime/me`, { jar, correlationId: cid("next-me") });
  let e = contract.conforms(doc, "/api/runtime/me", "GET", r);
  check("next.me", r.status === 200 && r.json?.organisations?.map((o) => o.code).join() === "NOVA" && JSON.stringify(r.json?.authMethods) === '["pwd","otp"]' && e.length === 0 && sameCorr(r) && noStore(r),
    `GET /api/runtime/me with session: HTTP ${r.status} NOVA, authMethods ${JSON.stringify(r.json?.authMethods)}; matches Me; correlation echoed${show(e)}`);
  const meId = r.sent;
  const unsafe = await call(`${WEB}/api/runtime/me`, { jar, correlationId: "bad id; drop" });
  const replaced = corr(unsafe);
  r = await call(`${WEB}/api/auth/session`, { jar, correlationId: cid("next-session") });
  e = contract.conforms(doc, "/api/auth/session", "GET", r);
  check("next.session", r.status === 200 && r.json?.authenticated === true && e.length === 0 && sameCorr(r) && !/eyJ|access_?token|refresh_?token|id_?token/i.test(r.text),
    `GET /api/auth/session: ${r.status} authenticated, no token fields; matches SessionView${show(e)}`);
  const anonSession = await call(`${WEB}/api/auth/session`, { correlationId: cid("next-session") });
  const anon = await call(`${WEB}/api/runtime/me`, { correlationId: cid("next-401") });
  const bearer = await call(`${WEB}/api/runtime/me`, { token: novaToken, correlationId: cid("next-bearer") });
  e = [...contract.conforms(doc, "/api/runtime/me", "GET", anon), ...contract.conforms(doc, "/api/runtime/me", "GET", bearer), ...contract.conforms(doc, "/api/auth/session", "GET", anonSession)];
  check("next.no-session", anon.status === 401 && anon.json?.error === "no_session" && bearer.status === 401 && bearer.json?.error === "no_session" && anonSession.json?.authenticated === false && e.length === 0 && sameCorr(anon) && sameCorr(bearer),
    `no cookie: ${anon.status} ${anon.json?.error}; valid Nova bearer token from the browser: ${bearer.status} ${bearer.json?.error} (not forwarded); /api/auth/session {authenticated:false}${show(e)}`);
  r = await call(`${WEB}/api/runtime/health`, { correlationId: cid("next-health") });
  e = contract.conforms(doc, "/api/runtime/health", "GET", r);
  check("next.health", r.status === 200 && r.json?.api === "UP" && e.length === 0 && sameCorr(r), `HTTP ${r.status} api=${r.json?.api}; matches RuntimeHealth${show(e)}`);

  const m405 = [];
  for (const [m, p] of [["POST", "/api/runtime/me"], ["PUT", "/api/runtime/me"], ["DELETE", "/api/runtime/me"], ["POST", "/api/runtime/health"], ["POST", "/api/auth/session"], ["GET", "/api/auth/logout"], ["POST", "/api/auth/login"], ["POST", "/api/auth/callback"]]) {
    const x = await call(`${WEB}${p}`, { method: m, jar, correlationId: cid("next-405"), headers: { Origin: WEB, "Content-Type": "application/json" }, body: m === "GET" ? undefined : "{}" });
    const op = Object.keys(doc.paths[p]).find((k) => ["get", "post"].includes(k));
    m405.push({ m, p, x, e: contract.conforms(doc, p, op.toUpperCase(), x) });
  }
  const cross = await call(`${WEB}/api/auth/logout`, { method: "POST", jar, correlationId: cid("next-cross"), headers: { Origin: "http://127.0.0.1:9999" } });
  e = [...m405.flatMap((x) => x.e), ...contract.conforms(doc, "/api/auth/logout", "POST", cross)];
  const still = await call(`${WEB}/api/runtime/me`, { jar, correlationId: cid("next-still") });
  check("next.denied-write", m405.every((x) => x.x.status === 405 && x.x.json?.error === "method_not_allowed" && x.x.headers.get("allow") && sameCorr(x.x)) && cross.status === 403 && cross.json?.error === "cross_origin" && still.status === 200 && e.length === 0,
    `${m405.length} unsupported methods -> 405 method_not_allowed with Allow; cross-origin logout -> ${cross.status} ${cross.json?.error}; session still valid (${still.status})${show(e)}`);
  const um = [];
  for (const [m, p] of [["GET", `/api/runtime/model-applications/${NOVA_APP}/history`], ["POST", `/api/runtime/model-applications/${NOVA_APP}/submit`], ["GET", "/api/runtime/model-applications/a/b"], ["GET", "/api/nothing-here"]]) {
    const x = await call(`${WEB}${p}`, { method: m, jar, correlationId: cid("next-404"), body: m === "GET" ? undefined : "{}", headers: { "Content-Type": "application/json" } });
    um.push({ m, p, x, e: contract.validate(doc.components.schemas.Error, x.json, doc) });
  }
  check("next.unmatched-not-found", um.every((x) => x.x.status === 404 && x.x.json?.error === "not_found" && x.e.length === 0 && sameCorr(x.x) && noStore(x.x)),
    `${um.map((x) => `${x.m} ${x.p.replace(NOVA_APP, "{id}")} ${x.x.status}`).join(", ")} (no history or workflow route exists; JSON 404, not the HTML page)`);
  return { meId, replaced };
}

/**
 * With Spring stopped, a stand-in on Spring's port answers /api/me with (a) a valid Me plus
 * an undocumented secret field and (b) a 403 whose code and message are SQL-like text.
 * Neither value may reach a portal body, redirect URL or log; correlation IDs must survive.
 */
async function plantedValues(sessionJar, webStart) {
  const fake = standIn();
  const results = {};
  try {
    await fake.listen();
    for (const mode of ["extra-field", "sql-error"]) {
      fake.set(mode);
      const r = await call(`${WEB}/api/runtime/me`, { jar: sessionJar, correlationId: cid(`planted-${mode}`) });
      const signIn = await portalSignIn(ids.name(mode === "extra-field" ? "bee.finance" : "bee.programme"));
      results[mode] = { r, signIn, e: contract.conforms(doc, "/api/runtime/me", "GET", r) };
    }
  } finally {
    await fake.close();
  }
  const extra = results["extra-field"], sql = results["sql-error"];
  const sawId = (x) => fake.seen.some((v) => v.correlationId === x.sent && v.path === "/api/me" && v.bearer);
  check("next.planted-extra-field", extra.r.status === 502 && extra.r.json?.error === "invalid_api_response" && extra.e.length === 0 && sameCorr(extra.r) && sawId(extra.r) && !extra.r.text.includes(PLANTED_SECRET),
    `stand-in /api/me 200 = valid Me + secretToken: /api/runtime/me -> ${extra.r.status} ${extra.r.json?.error}; body ${extra.r.text}; correlation ${extra.r.sent} echoed and seen upstream${show(extra.e)}`);
  check("next.planted-sql-error", sql.r.status === 502 && sql.r.json?.error === "api_error" && sql.e.length === 0 && sameCorr(sql.r) && sawId(sql.r) && !PLANTED.some((x) => sql.r.text.includes(x)),
    `stand-in /api/me 403 {error: SQL text}: /api/runtime/me -> ${sql.r.status} ${sql.r.json?.error}; body ${sql.r.text}; correlation echoed and seen upstream${show(sql.e)}`);
  const cbOk = (x, code) => x.signIn.final?.pathname === "/login" && x.signIn.final.search === `?error=${code}` && !x.signIn.jar.has("bee_session") && sameCorr(x.signIn.cb) && fake.seen.some((v) => v.correlationId === x.signIn.cb?.sent);
  check("next.planted-callback", cbOk(extra, "invalid_api_response") && cbOk(sql, "api_error"),
    `callback with stand-in: extra field -> 303 ${extra.signIn.final?.pathname}${extra.signIn.final?.search}, SQL error -> 303 ${sql.signIn.final?.pathname}${sql.signIn.final?.search}; no session either way; callback correlation IDs echoed and seen upstream`);
  const webLog = logSince("web.log", webStart);
  const inPortal = PLANTED.filter((x) => webSeen.some((t) => t.includes(x)));
  const inLogs = PLANTED.filter((x) => webLog.includes(x) || logSince("api.log", 0).includes(x) || logSince("api.before-contract-restart.log", 0).includes(x));
  const upstreamLines = [extra.r.sent, sql.r.sent].map((id) => webLog.split("\n").find((l) => l.includes(`bee.upstream correlationId=${id} `)) || "");
  check("next.planted-values-contained", inPortal.length === 0 && inLogs.length === 0 && upstreamLines.every((l) => /status=(200|403) durationMs=/.test(l)),
    `planted secret and SQL text in ${webSeen.length} portal responses (bodies, headers, Location): ${inPortal.length ? "FOUND " + inPortal.length : "none"}; in web.log/api.log: ${inLogs.length ? "FOUND " + inLogs.length : "none"}; upstream log lines keep the correlation ID and status only ("${upstreamLines[1].replace(/^.*bee\.upstream /, "")}")`);
}

async function main() {
  inventory();
  const webStart = logSize("web.log");
  const nova = await totp.accessToken(ids.name("nova.applicant"));
  const inactive = await totp.accessToken(ids.name("inactive.role"));
  const noAmr = await tokenWithoutAmr(ids.name("pixel.applicant"));
  for (const t of [nova, inactive, noAmr]) secrets.add(t);

  /* enrolled now so their portal sign-ins later need no setup page and no step wait */
  for (const p of ["bee.programme", "bee.finance"]) await totp.ensureEnrolled(ids.name(p));

  const readId = await springChecks(nova, inactive, noAmr);

  const s = await portalSignIn(ids.name("nova.applicant"));
  check("next.sign-in", s.final?.pathname === "/app" && s.jar.has("bee_session") && sameCorr(s.cb) && noStore(s.cb) && sameCorr(s.login),
    `portal sign-in as test.nova.applicant: callback 303 -> ${s.final?.pathname}; correlation echoed on login and callback redirects`);
  const deniedLogin = await portalSignIn(ids.name("inactive.role"));
  check("next.inactive-role-sign-in", deniedLogin.final?.searchParams.get("error") === "no_effective_role" && !deniedLogin.jar.has("bee_session") && sameCorr(deniedLogin.cb),
    `test.inactive.role password+OTP -> callback 303 /login?error=${deniedLogin.final?.searchParams.get("error")}; no portal session (code listed in x-bee-login-redirect-codes: ${doc["x-bee-login-redirect-codes"].includes(deniedLogin.final?.searchParams.get("error"))})`);

  const { meId, replaced } = await nextChecks(s.jar, nova);

  const apiLog = logSince("api.log", 0);
  const webLog = logSince("web.log", webStart);
  const springRead = accessLine(apiLog, readId);
  const propagated = accessLine(apiLog, meId);
  const upstream = webLog.split("\n").find((l) => l.includes(`bee.upstream correlationId=${meId} `)) || "";
  const replacedLine = accessLine(apiLog, replaced || "none");
  check("correlation.propagated", /method=GET path=\/api\/me status=200/.test(propagated) && /path=\/api\/me status=200/.test(upstream) && /status=200/.test(springRead),
    `Next X-Correlation-Id ${meId} -> Spring access log "${propagated.replace(/^.*correlationId=/, "correlationId=").slice(0, 90)}" and Next upstream log line; direct Spring read logged with its ID`);
  check("correlation.unsafe-replaced-and-propagated", UUID_RE.test(replaced || "") && /path=\/api\/me status=200/.test(replacedLine),
    `browser sent "bad id; drop" -> Next issued ${replaced}; Spring logged the same replacement ID`);

  /* upstream unavailable: stop Spring, check the boundary, start it again */
  const before = await call(`${WEB}/api/runtime/me`, { jar: s.jar, correlationId: cid("next-before") });
  fs.copyFileSync(path.join(LOG_DIR, "api.log"), path.join(LOG_DIR, "api.before-contract-restart.log"));
  let down, health, sessionDuring, after;
  try {
    runtime("stop_api");
    down = await call(`${WEB}/api/runtime/me`, { jar: s.jar, correlationId: cid("next-down") });
    health = await call(`${WEB}/api/runtime/health`, { correlationId: cid("next-down-health") });
    sessionDuring = await call(`${WEB}/api/auth/session`, { jar: s.jar });
    await plantedValues(s.jar, webStart);
  } finally {
    runtime("start_api");
  }
  after = await call(`${WEB}/api/runtime/me`, { jar: s.jar, correlationId: cid("next-after") });
  const e = [...contract.conforms(doc, "/api/runtime/me", "GET", down), ...contract.conforms(doc, "/api/runtime/health", "GET", health)];
  check("next.upstream-unavailable", before.status === 200 && down.status === 503 && down.json?.error === "api_unreachable" && sameCorr(down) && noStore(down) && health.status === 503 && health.json?.api === "UNKNOWN" && sessionDuring.json?.authenticated === true && after.status === 200 && e.length === 0,
    `Spring stopped: /api/runtime/me ${down.status} ${down.json?.error}, /api/runtime/health ${health.status} api=${health.json?.api}, session kept; Spring restarted: /api/runtime/me ${after.status}${show(e)}`);

  const out = await call(`${WEB}/api/auth/logout`, { method: "POST", jar: s.jar, correlationId: cid("next-logout"), headers: { Origin: WEB } });
  const gone = await call(`${WEB}/api/runtime/me`, { jar: s.jar, correlationId: cid("next-gone") });
  const le = contract.conforms(doc, "/api/auth/logout", "POST", out);
  check("next.logout", out.status === 200 && out.json?.keycloakSessionEnded === true && gone.status === 401 && le.length === 0 && sameCorr(out), `logout ${out.status} (Keycloak session ended: ${out.json?.keycloakSessionEnded}); then /api/runtime/me ${gone.status} ${gone.json?.error}${show(le)}`);

  /* error bodies and logs must not carry tokens, internals or other records */
  const FORBIDDEN = /Exception|SELECT |\bSQL|jdbc|stack|\bat gov\.|org\.spring|keycloak|realm|eyJ[A-Za-z0-9_-]{10}|Bearer|127\.0\.0\.1|5434|8180/i;
  const leaks = errorBodies.filter((b) => {
    let j = null;
    try { j = JSON.parse(b.text); } catch {}
    const keysOk = j && Object.keys(j).join() === "error,message" && doc["x-bee-error-codes"][j.error]?.message === j.message;
    return !keysOk || FORBIDDEN.test(b.text) || b.text.includes(PIXEL_APP) || b.text.includes("LOCAL-MA-0003");
  });
  check("contract.error-bodies-safe", errorBodies.length > 30 && leaks.length === 0,
    `${errorBodies.length} error responses: all exactly {error, message} with the contract message; no record IDs, tokens, SQL, stack traces or Keycloak detail${leaks.length ? `; offending: ${leaks.slice(0, 2).map((l) => `${l.status} ${l.url} ${l.text.slice(0, 80)}`).join(" | ")}` : ""}`);
  const logs = logSince("api.before-contract-restart.log", 0) + logSince("api.log", 0) + logSince("web.log", webStart);
  const tokenInLog = [...secrets].some((t) => logs.includes(t.slice(-40))) || /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(logs);
  const codeInLog = /\/api\/auth\/callback\?|[?&]code=[^&\s]+/.test(logSince("web.log", webStart));
  check("logs.no-sensitive-data", !tokenInLog && !codeInLog && /bee\.access|correlationId=/.test(logs),
    `api.log and web.log since this run: tokens ${tokenInLog ? "FOUND" : "absent"}, callback code/state ${codeInLog ? "FOUND" : "absent"}; lines hold correlation ID, method, path, status and duration only`);
}

if (require.main === module) (async () => {
  await ids.withIdentities("test", main);
})()
  .catch((e) => check("contract.run", false, `aborted: ${e.message}`))
  .then(async () => {
    try { await deleteNoAmrClient(); } catch {}
    const left = await totp.admin(`/clients?clientId=${NO_AMR_CLIENT}`).catch(() => null);
    check("contract.temp-client-removed", Array.isArray(left) && left.length === 0, `${NO_AMR_CLIENT} clients left: ${Array.isArray(left) ? left.length : "unknown"}`);
    for (const p of ["nova.applicant", "inactive.role", "pixel.applicant", "bee.programme", "bee.finance"]) await totp.logoutUser(ids.name(p)).catch(() => {});
    console.log(`contract checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
