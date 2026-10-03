/* eslint-disable */
/**
 * WP03.1/WP03.3 cross-layer contract checks: live Spring (direct, as Next's server code calls it)
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
const logs = require("./request-logs.cjs");

const env = (k, d) => process.env[k] || d;
const ROOT = path.join(__dirname, "../..");
const WEB = `http://127.0.0.1:${env("BEE_WEB_PORT", "3100")}`;
const API = `http://127.0.0.1:${env("BEE_API_PORT", "8090")}`;
const ISSUER = `http://127.0.0.1:${env("BEE_KC_PORT", "8180")}/realms/${env("BEE_REALM", "bee-local")}`;
const LOG_DIR = path.join(ROOT, ".local/logs");
const NO_AMR_CLIENT = "bee-contract-no-amr";
const NOVA_APP = app(2), PIXEL_APP = app(3);
const SUBMIT_ROUTE = "/api/runtime/model-applications/{id}/submit";
const DOC_LIST_ROUTE = "/api/runtime/model-applications/{id}/documents";
const DOC_CONTENT_ROUTE = "/api/runtime/model-applications/{id}/documents/{documentId}/versions/{versionId}/content";
/** Mirrors lib/server/apiContract.ts SPRING_DOC_* (stand-in hits Spring, not the portal session layer). */
const DOC_READ_UPSTREAM = {
  GET: { 401: ["unauthenticated"], 403: ["mfa_required", "no_active_account", "no_effective_role", "no_read_scope"], 404: ["not_found"], 503: ["service_unavailable"] },
};
const DOC_UPLOAD_UPSTREAM = {
  POST: { 401: ["unauthenticated"], 403: ["mfa_required", "no_active_account", "no_effective_role", "no_write_scope", "brand_not_permitted", "not_editable"], 404: ["not_found"], 409: ["idempotency_key_conflict", "idempotency_in_progress"], 422: ["validation_failed", "idempotency_key_required"], 503: ["service_unavailable"] },
};
/** Mirrors lib/server/apiContract.ts SPRING_SUBMIT_* (stand-in hits Spring, not the portal session layer). */
const SUBMIT_UPSTREAM = {
  GET: { 401: ["unauthenticated"], 403: ["mfa_required", "no_active_account", "no_effective_role", "no_write_scope", "not_submittable"], 404: ["not_found"], 503: ["service_unavailable"] },
  POST: { 401: ["unauthenticated"], 403: ["mfa_required", "no_active_account", "no_effective_role", "no_write_scope", "brand_not_permitted", "not_submittable"], 404: ["not_found"], 409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress", "fee_preview_conflict", "duplicate_model"], 422: ["validation_failed", "idempotency_key_required", "rule_not_available", "test_report_required", "declared_efficiency_required", "test_date_invalid", "laboratory_not_accredited", "standard_not_available"], 503: ["service_unavailable"] },
};
const WRITE_DENIALS = ["mfa_required", "no_active_account", "no_effective_role", "no_write_scope", "brand_not_permitted", "not_editable", "not_submittable"];
const DRAFT_UPSTREAM = {
  GET: { 401: ["unauthenticated"], 403: WRITE_DENIALS, 503: ["service_unavailable"] },
  POST: { 401: ["unauthenticated"], 403: WRITE_DENIALS, 409: ["idempotency_key_conflict", "idempotency_in_progress"], 422: ["validation_failed", "idempotency_key_required"], 503: ["service_unavailable"] },
  PATCH: { 401: ["unauthenticated"], 403: WRITE_DENIALS, 404: ["not_found"], 409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"], 422: ["validation_failed", "idempotency_key_required"], 503: ["service_unavailable"] },
};
const BRANDS_ROUTE = "/api/runtime/model-applications/eligible-brands";
const LIST_ROUTE = "/api/runtime/model-applications";
const DETAIL_ROUTE = "/api/runtime/model-applications/{id}";
const upstreamLogRoute = (route, method) => {
  if (route === "/api/runtime/me") return "/api/me";
  if (route === SUBMIT_ROUTE) return "/api/model-applications/{id}/submit";
  if (route === DOC_LIST_ROUTE) return "/api/model-applications/{id}/documents";
  if (route === DOC_CONTENT_ROUTE) return "/api/model-applications/{id}/documents/{documentId}/versions/{versionId}/content";
  if (route === BRANDS_ROUTE) return "/api/model-applications/eligible-brands";
  if (route === LIST_ROUTE && method === "POST") return "/api/model-applications";
  return route.replace("/api/runtime", "/api");
};
const contractUploadMultipart = () => {
  const boundary = "bee-contract-check";
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="contract.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 contract-check\r\n--${boundary}\r\nContent-Disposition: form-data; name="documentKind"\r\n\r\ntest_report\r\n--${boundary}\r\nContent-Disposition: form-data; name="reportLabel"\r\n\r\nContract check upload\r\n--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const doc = contract.load();
let realMe = null;

/* ---------- stand-in for Spring on its port while Spring is stopped: planted values ---------- */
const PLANTED_SECRET = `planted-secret-${crypto.randomBytes(6).toString("hex")}`;
const PLANTED_SQL = `ERROR: relation "app.user_account" does not exist; SELECT password_hash FROM app.user_account WHERE marker='${crypto.randomBytes(4).toString("hex")}' -- at gov.bee.api.Repo`;
const PLANTED = [PLANTED_SECRET, PLANTED_SQL, encodeURIComponent(PLANTED_SQL), "password_hash", "SELECT password", PLANTED_SQL.slice(-30)];
function standIn() {
  const seen = [];
  let mode = "extra-field", answer = null;
  const server = http.createServer((req, res) => {
    const id = req.headers["x-correlation-id"];
    seen.push({ mode, path: req.url, correlationId: id, bearer: /^Bearer \S+$/.test(req.headers.authorization || "") });
    const [status, body] = mode === "documented" ? answer : mode === "extra-field" ? [200, { ...realMe, secretToken: PLANTED_SECRET }] : [403, { error: PLANTED_SQL, message: PLANTED_SQL }];
    res.writeHead(status, { "Content-Type": "application/json", ...(id ? { "X-Correlation-Id": id } : {}) });
    res.end(JSON.stringify(body));
  });
  return {
    seen,
    set: (m, a = null) => { mode = m; answer = a; },
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
function sqlq(statement) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${env("BEE_APP_DB_PASSWORD", "bee-local-app")}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", statement]).toString().trim();
}
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
    if (METHODS.some((m) => new RegExp(`export (async )?function ${m}\\b`).test(src))) problems.push(`${route} exports an unlogged handler function`);
    /* every method export is logged("<template>", handler), logged("<template>", methodNotAllowed(...)) or an alias of one */
    const exp = Object.fromEntries([...src.matchAll(/^export const (GET|POST|PUT|PATCH|DELETE) = (.+)$/gm)].map((m) => [m[1], m[2]]));
    const kind = (m, seen = 0) => {
      const rhs = exp[m] || "";
      if (/^[A-Z]+;$/.test(rhs) && seen < 3) return kind(rhs.slice(0, -1), seen + 1);
      if (/^logged\("[^"]+", methodNotAllowed\(/.test(rhs) || (/^notFound;$/.test(rhs))) return "405";
      if (/^logged\("[^"]+", /.test(rhs)) return "handled";
      return rhs ? "unlogged" : "missing";
    };
    const handled = METHODS.filter((m) => kind(m) === "handled");
    const declared = METHODS.filter((m) => kind(m) === "405");
    for (const m of METHODS.filter((x) => kind(x) === "unlogged")) problems.push(`${route} ${m} is not wrapped in logged()`);
    const loggedRoutes = [...new Set([...src.matchAll(/logged\("([^"]+)"/g)].map((m) => m[1]))];
    codeRoutes[route] = { handled, declared };
    if (/\[\.\.\./.test(route)) {
      if (doc["x-bee-unmatched"]?.browser?.route !== route) problems.push(`${route} not described in x-bee-unmatched`);
      if (loggedRoutes.join() !== "/api/{unmatched}") problems.push(`${route} logs as ${loggedRoutes}`);
      continue;
    }
    if (loggedRoutes.join() !== route) problems.push(`${route} logs as ${loggedRoutes}`);
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
    for (const m of src.matchAll(/@GetMapping\("([^"]+)"\)/g)) mappings.add(m[1]);
  }
  const security = fs.readFileSync(path.join(ROOT, "backend/src/main/java/gov/bee/api/security/SecurityConfig.java"), "utf8");
  const allowed = [...security.matchAll(/requestMatchers\(HttpMethod\.(\w+), ([^)]+)\)/g)].flatMap((m) => [...m[2].matchAll(/"([^"]+)"/g)].map((x) => `${m[1]} ${x[1]}`));
  const internalPaths = internal.map(([r]) => r).sort();
  const springPaths = [...mappings, "/actuator/health"].sort();
  if (springPaths.join() !== internalPaths.join()) problems.push(`Spring GET mappings ${springPaths} vs contract ${internalPaths}`);
  const expectAllowed = ["GET /actuator/health", "GET /actuator/health/**", "GET /api/me", "GET /api/model-applications/eligible-brands", "GET /api/model-applications", "GET /api/model-applications/*", "GET /api/model-applications/*/submit", "POST /api/model-applications", "PATCH /api/model-applications/*", "POST /api/model-applications/*/submit", "GET /api/model-applications/*/documents", "POST /api/model-applications/*/documents", "GET /api/model-applications/*/documents/*/versions/*/content"];
  if (allowed.sort().join() !== expectAllowed.sort().join()) problems.push(`SecurityConfig matchers changed: ${allowed}`);
  check("contract.inventory", problems.length === 0,
    `${routes.length} Next route files vs ${browser.length} browser paths + catch-all; ${springPaths.length} Spring GET routes vs ${internalPaths.length} internal paths; SecurityConfig matchers unchanged (${allowed.length})${show(problems)}`);
  check("contract.deferred-not-operational", doc["x-bee-deferred"].length >= 4 && doc["x-bee-deferred"].every((d) => d.owner && d.status !== "operational"),
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
  for (const [p, op] of [["/api/me", "/api/me"], ["/api/model-applications", "/api/model-applications"], [`/api/model-applications/${NOVA_APP}`, R]]) {
    const x = await call(`${API}${p}`, { token: inactive, correlationId: cid("spring-inactive") });
    ina.push({ p, x, e: contract.conforms(doc, op, "GET", x) });
  }
  check("spring.inactive-role", ina.every((m) => m.x.status === 403 && m.x.json?.error === "no_effective_role" && m.e.length === 0 && sameCorr(m.x)),
    `test.inactive.role: ${ina.map((m) => `${m.p.replace(NOVA_APP, "{id}")} ${m.x.status} ${m.x.json?.error}`).join(", ")}${show(ina.flatMap((m) => m.e))}`);

  const draftMissingKey = [["POST", "/api/model-applications"], ["PATCH", `/api/model-applications/${NOVA_APP}`], ["POST", `/api/model-applications/${NOVA_APP}/submit`], ["POST", `/api/model-applications/${NOVA_APP}/documents`]];
  const deniedWrites = [["PUT", `/api/model-applications/${NOVA_APP}`], ["DELETE", `/api/model-applications/${NOVA_APP}`],
    ["GET", `/api/model-applications/${NOVA_APP}/history`], ["POST", "/api/me"], ["GET", "/actuator/env"]];
  const want = JSON.stringify({ error: "denied_by_default", message: doc["x-bee-error-codes"].denied_by_default.message });
  const denied = [];
  for (const [m, p] of deniedWrites) {
    const x = await call(`${API}${p}`, { method: m, token: nova, correlationId: cid("spring-write"), headers: { "Content-Type": "application/json" }, body: m === "GET" ? undefined : "{}" });
    denied.push({ m, p, x, e: contract.validate(doc.components.schemas.Error, x.json, doc) });
  }
  const missingKey = [];
  for (const [m, p] of draftMissingKey) {
    const mp = p.includes("/documents") ? contractUploadMultipart() : null;
    const x = await call(`${API}${p}`, {
      method: m, token: nova, correlationId: cid("spring-draft-key"),
      headers: mp ? { "Content-Type": mp.contentType } : { "Content-Type": "application/json" },
      body: mp ? mp.body : "{}",
    });
    missingKey.push({ m, p, x, e: contract.validate(doc.components.schemas.Error, x.json, doc) });
  }
  const anon = await call(`${API}/api/model-applications`, { method: "POST", correlationId: cid("spring-write-anon"), body: "{}", headers: { "Content-Type": "application/json" } });
  for (const d of denied) contract.record({ route: "default-deny", method: d.m, status: d.x.status, code: d.x.json?.error ?? null, ok: d.x.status === 403 && d.x.text === want && d.e.length === 0 && sameCorr(d.x) && noStore(d.x) });
  for (const d of missingKey) {
    const route = d.p.includes("/documents") ? "/api/model-applications/{id}/documents" : d.p.includes("/submit") ? "/api/model-applications/{id}/submit" : d.p.includes(NOVA_APP) ? "/api/model-applications/{id}" : d.p.replace(`${API}`, "");
    contract.record({ route, method: d.m, status: d.x.status, code: d.x.json?.error ?? null, ok: d.x.status === 422 && d.x.json?.error === "idempotency_key_required" && d.e.length === 0 && sameCorr(d.x) && noStore(d.x) });
  }
  contract.record({ route: "default-deny", method: "POST", status: anon.status, code: anon.json?.error ?? null, ok: anon.status === 401 && contract.validate(doc.components.schemas.Error, anon.json, doc).length === 0 && noStore(anon) });
  check("spring.denied-write", denied.every((d) => d.x.status === 403 && d.x.text === want && d.e.length === 0 && sameCorr(d.x))
    && missingKey.every((d) => d.x.status === 422 && d.x.json?.error === "idempotency_key_required" && d.e.length === 0 && sameCorr(d.x))
    && anon.status === 401 && anon.json?.error === "unauthenticated",
    `${denied.length} unmapped -> denied_by_default; draft POST/PATCH without key -> idempotency_key_required; anon POST -> ${anon.status} ${anon.json?.error}`);

  const h = await call(`${API}/actuator/health`, { correlationId: cid("spring-health") });
  const he = contract.conforms(doc, "/actuator/health", "GET", h);
  check("spring.health", h.status === 200 && h.json?.status === "UP" && he.length === 0 && sameCorr(h) && noStore(h), `GET /actuator/health without a token: HTTP ${h.status} ${h.json?.status}; matches SpringHealth; correlation echoed; no-store${show(he)}`);

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
  const submitAnonGet = await call(`${WEB}/api/runtime/model-applications/${NOVA_APP}/submit`, { correlationId: cid("next-submit-anon-get") });
  const submitAnonPost = await call(`${WEB}/api/runtime/model-applications/${NOVA_APP}/submit`, {
    method: "POST", correlationId: cid("next-submit-anon-post"), headers: { "Content-Type": "application/json", "Idempotency-Key": "0123456789abcdef0123457" }, body: "{}",
  });
  e = [...contract.conforms(doc, "/api/runtime/model-applications/{id}/submit", "GET", submitAnonGet), ...contract.conforms(doc, "/api/runtime/model-applications/{id}/submit", "POST", submitAnonPost)];
  const submitNoSessOk = submitAnonGet.status === 401 && submitAnonGet.json?.error === "no_session" && submitAnonPost.status === 401 && submitAnonPost.json?.error === "no_session" && e.length === 0;
  contract.record({ route: "/api/runtime/model-applications/{id}/submit", method: "GET", status: submitAnonGet.status, code: submitAnonGet.json?.error ?? "-", ok: submitNoSessOk && contract.conforms(doc, "/api/runtime/model-applications/{id}/submit", "GET", submitAnonGet).length === 0 });
  contract.record({ route: "/api/runtime/model-applications/{id}/submit", method: "POST", status: submitAnonPost.status, code: submitAnonPost.json?.error ?? "-", ok: submitNoSessOk && contract.conforms(doc, "/api/runtime/model-applications/{id}/submit", "POST", submitAnonPost).length === 0 });
  check("next.submit-no-session", submitNoSessOk && sameCorr(submitAnonGet) && sameCorr(submitAnonPost),
    `GET/POST runtime submit without cookie: ${submitAnonGet.status} ${submitAnonGet.json?.error}, ${submitAnonPost.status} ${submitAnonPost.json?.error}${show(e)}`);
  const docListAnonGet = await call(`${WEB}/api/runtime/model-applications/${NOVA_APP}/documents`, { correlationId: cid("next-doc-anon-get") });
  const docUploadMp = contractUploadMultipart();
  const docListAnonPost = await call(`${WEB}/api/runtime/model-applications/${NOVA_APP}/documents`, {
    method: "POST", correlationId: cid("next-doc-anon-post"), headers: { "Content-Type": docUploadMp.contentType, "Idempotency-Key": "0123456789abcdef0123456" }, body: docUploadMp.body,
  });
  const docContentAnonGet = await call(`${WEB}/api/runtime/model-applications/${NOVA_APP}/documents/${crypto.randomUUID()}/versions/${crypto.randomUUID()}/content`, { correlationId: cid("next-doc-anon-content") });
  e = [...e, ...contract.conforms(doc, DOC_LIST_ROUTE, "GET", docListAnonGet), ...contract.conforms(doc, DOC_LIST_ROUTE, "POST", docListAnonPost), ...contract.conforms(doc, DOC_CONTENT_ROUTE, "GET", docContentAnonGet)];
  const docNoSessOk = docListAnonGet.status === 401 && docListAnonGet.json?.error === "no_session"
    && docListAnonPost.status === 401 && docListAnonPost.json?.error === "no_session"
    && docContentAnonGet.status === 401 && docContentAnonGet.json?.error === "no_session";
  for (const [route, method, r] of [[DOC_LIST_ROUTE, "GET", docListAnonGet], [DOC_LIST_ROUTE, "POST", docListAnonPost], [DOC_CONTENT_ROUTE, "GET", docContentAnonGet]]) {
    contract.record({ route, method, status: r.status, code: r.json?.error ?? "-", ok: docNoSessOk && contract.conforms(doc, route, method, r).length === 0 && sameCorr(r) });
  }
  check("next.documents-no-session", docNoSessOk && sameCorr(docListAnonGet) && sameCorr(docListAnonPost) && sameCorr(docContentAnonGet),
    `GET/POST runtime documents and GET content without cookie: ${docListAnonGet.status} ${docListAnonGet.json?.error}, ${docListAnonPost.status} ${docListAnonPost.json?.error}, ${docContentAnonGet.status} ${docContentAnonGet.json?.error}${show(e)}`);
  const anonBrands = await call(`${WEB}/api/runtime/model-applications/eligible-brands`, { correlationId: cid("next-brands-anon") });
  const anonCreate = await call(`${WEB}/api/runtime/model-applications`, {
    method: "POST", correlationId: cid("next-create-anon"), headers: { "Content-Type": "application/json", "Idempotency-Key": "0123456789abcdef0123458" }, body: "{}",
  });
  const anonPatch = await call(`${WEB}/api/runtime/model-applications/${NOVA_APP}`, {
    method: "PATCH", correlationId: cid("next-patch-anon"), headers: { "Content-Type": "application/json", "Idempotency-Key": "0123456789abcdef0123459" }, body: "{}",
  });
  for (const [route, method, r] of [
    [BRANDS_ROUTE, "GET", anonBrands],
    [LIST_ROUTE, "POST", anonCreate],
    [DETAIL_ROUTE, "PATCH", anonPatch],
  ]) {
    const ce = contract.conforms(doc, route, method, r);
    const ok = r.status === 401 && r.json?.error === "no_session" && ce.length === 0 && sameCorr(r);
    contract.record({ route, method, status: r.status, code: r.json?.error ?? "-", ok });
  }
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
  for (const [m, p] of [["GET", `/api/runtime/model-applications/${NOVA_APP}/history`], ["POST", `/api/runtime/model-applications/${NOVA_APP}/history`], ["GET", "/api/runtime/model-applications/a/b"], ["GET", "/api/nothing-here"]]) {
    const x = await call(`${WEB}${p}`, { method: m, jar, correlationId: cid("next-404"), body: m === "GET" ? undefined : "{}", headers: { "Content-Type": "application/json" } });
    um.push({ m, p, x, e: contract.validate(doc.components.schemas.Error, x.json, doc) });
  }
  for (const x of um) contract.record({ route: "unmatched", method: x.m, status: x.x.status, code: x.x.json?.error ?? null, ok: x.x.status === 404 && x.e.length === 0 && sameCorr(x.x) && noStore(x.x) });
  check("next.unmatched-not-found", um.every((x) => x.x.status === 404 && x.x.json?.error === "not_found" && x.e.length === 0 && sameCorr(x.x) && noStore(x.x)),
    `${um.map((x) => `${x.m} ${x.p.replace(NOVA_APP, "{id}")} ${x.x.status}`).join(", ")} (no history or workflow route exists; JSON 404, not the HTML page)`);
  return { meId, replaced };
}

/**
 * With Spring stopped, a stand-in on Spring's port answers /api/me with (a) a valid Me plus
 * an undocumented secret field and (b) a 403 whose code and message are SQL-like text.
 * Neither value may reach a portal body, redirect URL or log; correlation IDs must survive.
 * Then it answers every documented Spring error code in turn, so each browser read route's
 * documented mapping (pass through, or 502 api_error when that code is not listed for the
 * route) is exercised at the real Next.js boundary; evidence labelled "live-stand-in".
 */
async function plantedValues(sessionJar, m0) {
  const fake = standIn();
  const results = {};
  const documented = [];
  const SPRING_ERRORS = [[401, "unauthenticated"], [403, "mfa_required"], [403, "no_active_account"], [403, "no_effective_role"], [403, "no_read_scope"], [404, "not_found"], [503, "service_unavailable"]];
  const READS = [["/api/runtime/me", "/api/runtime/me"], ["/api/runtime/model-applications", "/api/runtime/model-applications"], ["/api/runtime/model-applications/{id}", `/api/runtime/model-applications/${NOVA_APP}`], [DOC_LIST_ROUTE, `/api/runtime/model-applications/${NOVA_APP}/documents`]];
  const DOC_CONTENT_URL = `/api/runtime/model-applications/${NOVA_APP}/documents/${crypto.randomUUID()}/versions/${crypto.randomUUID()}/content`;
  const SUBMIT_URL = `/api/runtime/model-applications/${NOVA_APP}/submit`;
  async function exerciseStandInPairs(route, url, method, jar, upstreamTable = SUBMIT_UPSTREAM) {
    const op = doc.paths[route]?.[method.toLowerCase()];
    if (!op) return;
    const uploadMultipart = route === DOC_LIST_ROUTE && method === "POST";
    for (const [status, spec] of Object.entries(op.responses)) {
      const st = Number(status);
      if (st === 200 || st === 201) continue;
      for (const code of spec["x-error-codes"] || []) {
        if (code === "no_session") continue;
        fake.set("documented", [st, { error: code, message: doc["x-bee-error-codes"][code]?.message || code }]);
        const headers = {};
        let body;
        if (uploadMultipart) {
          const mp = contractUploadMultipart();
          headers["Content-Type"] = mp.contentType;
          headers["Idempotency-Key"] = "0123456789abcdef0123456";
          body = mp.body;
        } else {
          headers["Content-Type"] = "application/json";
          if (method === "POST" || method === "PATCH") headers["Idempotency-Key"] = "0123456789abcdef0123456";
          if (method === "POST" || method === "PATCH") body = "{}";
        }
        const x = await call(`${WEB}${url}`, { jar, method, correlationId: cid("standin-doc"), headers, body });
        const upstreamOk = st === 502
          ? (spec["x-error-codes"] || []).includes(code)
          : (upstreamTable[method]?.[st] || []).includes(code);
        const wantStatus = upstreamOk ? st : 502;
        const wantCode = upstreamOk ? code : "api_error";
        const e = contract.conforms(doc, route, method, x);
        const ok = x.status === wantStatus && x.json?.error === wantCode && e.length === 0 && sameCorr(x) && noStore(x);
        contract.record({ route, method, status: x.status, code: x.json?.error ?? "-", ok });
        documented.push({ route, method, status: st, code, x, want: [wantStatus, wantCode], e });
      }
    }
  }
  try {
    await fake.listen();
    contract.setSource("live-stand-in");
    for (const mode of ["extra-field", "sql-error"]) {
      fake.set(mode);
      const r = await call(`${WEB}/api/runtime/me`, { jar: sessionJar, correlationId: cid(`planted-${mode}`) });
      const signIn = await portalSignIn(ids.name(mode === "extra-field" ? "bee.finance" : "bee.programme"));
      results[mode] = { r, signIn, e: contract.conforms(doc, "/api/runtime/me", "GET", r) };
    }
    for (const [route, url] of READS) {
      for (const [status, code] of SPRING_ERRORS) {
        fake.set("documented", [status, { error: code, message: doc["x-bee-error-codes"][code].message }]);
        const x = await call(`${WEB}${url}`, { jar: sessionJar, correlationId: cid("standin-documented") });
        const listed = doc.paths[route].get.responses[String(status)]?.["x-error-codes"]?.includes(code);
        const e = contract.conforms(doc, route, "GET", x);
        const want = listed ? [status, code] : [502, "api_error"];
        const ok = x.status === want[0] && x.json?.error === want[1] && e.length === 0 && sameCorr(x) && noStore(x);
        contract.record({ route, method: "GET", status: x.status, code: x.json?.error ?? "-", ok });
        documented.push({ route, method: "GET", status, code, x, want, e });
      }
    }
    await exerciseStandInPairs(BRANDS_ROUTE, "/api/runtime/model-applications/eligible-brands", "GET", sessionJar, DRAFT_UPSTREAM);
    await exerciseStandInPairs(LIST_ROUTE, "/api/runtime/model-applications", "POST", sessionJar, DRAFT_UPSTREAM);
    await exerciseStandInPairs(DETAIL_ROUTE, `/api/runtime/model-applications/${NOVA_APP}`, "PATCH", sessionJar, DRAFT_UPSTREAM);
    await exerciseStandInPairs(SUBMIT_ROUTE, SUBMIT_URL, "GET", sessionJar);
    await exerciseStandInPairs(SUBMIT_ROUTE, SUBMIT_URL, "POST", sessionJar);
    await exerciseStandInPairs(DOC_LIST_ROUTE, `/api/runtime/model-applications/${NOVA_APP}/documents`, "GET", sessionJar, DOC_READ_UPSTREAM);
    await exerciseStandInPairs(DOC_LIST_ROUTE, `/api/runtime/model-applications/${NOVA_APP}/documents`, "POST", sessionJar, DOC_UPLOAD_UPSTREAM);
    await exerciseStandInPairs(DOC_CONTENT_ROUTE, DOC_CONTENT_URL, "GET", sessionJar, DOC_READ_UPSTREAM);
  } finally {
    contract.setSource("live");
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

  const badDoc = documented.filter((d) => {
    const t = logs.trace(d.x.sent, m0);
    const upstreamRoute = upstreamLogRoute(d.route, d.method);
    const esc = (s) => s.replace(/[{}]/g, "\\$&");
    const traceOk = follows(t, { web: [new RegExp(`^upstream ${d.method} ${esc(upstreamRoute)} ${d.status} ${d.code}$`), new RegExp(`^request ${d.method} ${esc(d.route)} ${d.want[0]} ${d.want[1]}$`)] }) && t.api.length === 0;
    return !(d.x.status === d.want[0] && d.x.json?.error === d.want[1] && d.e.length === 0 && sameCorr(d.x) && traceOk);
  });
  const passThrough = documented.filter((d) => d.want[0] !== 502).length;
  const remapped = documented.filter((d) => d.want[0] === 502).length;
  check("next.stand-in-documented-errors", documented.length > 0 && badDoc.length === 0,
    `stand-in exercised ${documented.length} browser error pairs (reads + runtime submit GET/POST): ${passThrough} passed through as documented, ${remapped} unlisted on route -> 502 api_error; each traced web upstream -> request with the same correlation ID${badDoc.length ? `; wrong: ${badDoc.slice(0, 3).map((d) => `${d.method} ${d.route} ${d.status} ${d.code} -> ${d.x.status} ${d.x.json?.error} ${traced(logs.trace(d.x.sent, m0))}`).join(" | ")}` : ""}${show(badDoc.flatMap((d) => d.e))}`);

  const allLogs = logs.allText(m0);
  const inPortal = PLANTED.filter((x) => webSeen.some((t) => t.includes(x)));
  const inLogs = PLANTED.filter((x) => allLogs.includes(x));
  const upstreamLines = [extra.r.sent, sql.r.sent].map((id) => logs.trace(id, m0).web.filter((l) => l.event === "upstream").map(logs.describe)[0] || "");
  check("next.planted-values-contained", inPortal.length === 0 && inLogs.length === 0 && upstreamLines[0] === "upstream GET /api/me 200 ok" && upstreamLines[1] === "upstream GET /api/me 403 unlisted",
    `planted secret and SQL text in ${webSeen.length} portal responses (bodies, headers, Location): ${inPortal.length ? "FOUND " + inPortal.length : "none"}; in structured and console logs: ${inLogs.length ? "FOUND " + inLogs.length : "none"}; upstream lines "${upstreamLines.join('", "')}" (SQL-like code logged as "unlisted")`);
}

/** Planted request values the portal and Spring must never echo or log. */
const PLANT = {
  query: `plantedq${crypto.randomBytes(5).toString("hex")}`,
  cookie: `plantedc${crypto.randomBytes(5).toString("hex")}`,
  bearer: `plantedb${crypto.randomBytes(5).toString("hex")}`,
  body: `plantedy${crypto.randomBytes(5).toString("hex")}`,
  segment: `plantedp${crypto.randomBytes(5).toString("hex")}`,
  code: `plantedo${crypto.randomBytes(5).toString("hex")}`,
  state: `planteds${crypto.randomBytes(5).toString("hex")}`,
  correlation: `plantedx ${crypto.randomBytes(5).toString("hex")}`,
};

async function plantedRequests(jar, nova) {
  const out = [];
  const q = `?returnTo=/app&token=${PLANT.query}&email=${PLANT.query}`;
  const withCookie = (j) => { const c = new Jar(); for (const [k, v] of j.c) c.c.set(k, v); c.c.set(`127.0.0.1|plant`, PLANT.cookie); return c; };
  for (const [m, p, opts] of [
    ["GET", `/api/runtime/me${q}`, { jar: withCookie(jar) }],
    ["GET", `/api/runtime/model-applications${q}`, { jar: withCookie(jar), token: PLANT.bearer }],
    ["GET", `/api/runtime/model-applications/${PLANT.segment}${q}`, { jar }],
    ["GET", `/api/runtime/${PLANT.segment}/x${q}`, { jar }],
    ["POST", `/api/runtime/me${q}`, { jar, body: JSON.stringify({ password: PLANT.body }), headers: { Origin: WEB, "Content-Type": "application/json" } }],
    ["GET", `/api/auth/session${q}`, { jar: withCookie(jar) }],
    ["GET", `/api/auth/login${q}`, { jar: new Jar() }],
    ["GET", `/api/auth/callback?code=${PLANT.code}&state=${PLANT.state}&iss=${encodeURIComponent(ISSUER)}&session_state=${PLANT.query}`, { jar: withCookie(new Jar()) }],
    ["GET", `/api/runtime/health${q}`, {}],
  ]) {
    out.push({ m, p, x: await call(`${WEB}${p}`, { method: m, correlationId: cid("plant"), ...opts }) });
  }
  const unsafe = await call(`${WEB}/api/runtime/me`, { jar, correlationId: PLANT.correlation });
  const springSide = [
    await call(`${API}/api/me${q}`, { token: nova, correlationId: cid("plant-spring"), headers: { Cookie: `plant=${PLANT.cookie}` } }),
    await call(`${API}/api/model-applications/${PLANT.segment}${q}`, { token: PLANT.bearer, correlationId: cid("plant-spring") }),
    await call(`${API}/api/model-applications${q}`, { method: "POST", token: nova, correlationId: cid("plant-spring"), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PLANT.body }) }),
  ];
  return { out, unsafe, springSide };
}

async function main() {
  inventory();
  const m0 = logs.mark();
  const nova = await totp.accessToken(ids.name("nova.applicant"));
  const inactive = await totp.accessToken(ids.name("inactive.role"));
  const noAmr = await tokenWithoutAmr(ids.name("pixel.applicant"));
  for (const t of [nova, inactive, noAmr]) secrets.add(t);

  /* enrolled now so their portal sign-ins later need no setup page and no step wait */
  for (const p of ["bee.programme", "bee.finance"]) await totp.ensureEnrolled(ids.name(p));

  const readId = await springChecks(nova, inactive, noAmr);

  const s = await portalSignIn(ids.name("nova.applicant"));
  const se = [...contract.conforms(doc, "/api/auth/login", "GET", s.login), ...contract.conforms(doc, "/api/auth/callback", "GET", s.cb)];
  check("next.sign-in", s.final?.pathname === "/app" && s.jar.has("bee_session") && sameCorr(s.cb) && noStore(s.cb) && sameCorr(s.login) && se.length === 0,
    `portal sign-in as test.nova.applicant: login 303, callback 303 -> ${s.final?.pathname}; both match the contract; correlation echoed on login and callback redirects${show(se)}`);
  const deniedLogin = await portalSignIn(ids.name("inactive.role"));
  const de = contract.conforms(doc, "/api/auth/callback", "GET", deniedLogin.cb);
  check("next.inactive-role-sign-in", deniedLogin.final?.searchParams.get("error") === "no_effective_role" && !deniedLogin.jar.has("bee_session") && sameCorr(deniedLogin.cb) && de.length === 0,
    `test.inactive.role password+OTP -> callback 303 /login?error=${deniedLogin.final?.searchParams.get("error")}; no portal session (code listed in x-bee-login-redirect-codes: ${doc["x-bee-login-redirect-codes"].includes(deniedLogin.final?.searchParams.get("error"))})${show(de)}`);
  const stale = await call(`${WEB}/api/auth/callback?code=${PLANT.code}&state=${PLANT.state}`, { correlationId: cid("callback-stale") });
  const ste = contract.conforms(doc, "/api/auth/callback", "GET", stale);
  check("next.callback-without-login", stale.status === 303 && new URL(stale.location, WEB).search === "?error=login_expired" && sameCorr(stale) && ste.length === 0,
    `callback with a planted code and state but no login cookie -> ${stale.status} ${stale.location}${show(ste)}`);

  const { meId, replaced } = await nextChecks(s.jar, nova);

  /* ---------- correlation: browser -> Next.js -> Spring (and Keycloak calls in the portal log) ---------- */
  const cor = [];
  const expect = (label, id, want, extra = () => true) => { const t = logs.trace(id, m0); cor.push({ label, id, ok: !!id && follows(t, want) && extra(t), t }); };
  expect("successful read", meId, { web: [/^upstream GET \/api\/me 200 ok$/, /^request GET \/api\/runtime\/me 200 ok$/], api: [/^request GET \/api\/me 200 ok$/] });
  expect("direct Spring read", readId, { api: [/^request GET \/api\/model-applications\/\{id\} 200 ok$/] }, (t) => t.web.length === 0);
  expect("sign-in", s.cb?.sent, { web: [/^identity token\.code 200 ok$/, /^upstream GET \/api\/me 200 ok$/, /^request GET \/api\/auth\/callback 303 ok$/], api: [/^request GET \/api\/me 200 ok$/] });
  expect("login redirect", s.login?.sent, { web: [/^request GET \/api\/auth\/login 303 ok$/] });
  expect("sign-in failure", deniedLogin.cb?.sent, { web: [/^identity token\.code 200 ok$/, /^upstream GET \/api\/me 403 no_effective_role$/, /^identity logout 2\d\d ok$/, /^request GET \/api\/auth\/callback 303 no_effective_role$/], api: [/^request GET \/api\/me 403 no_effective_role$/] });
  expect("callback without login", stale.sent, { web: [/^request GET \/api\/auth\/callback 303 login_expired$/] }, (t) => t.web.length === 1 && t.api.length === 0);
  expect("unsafe ID replaced", replaced, { web: [/^upstream GET \/api\/me 200 ok$/, /^request GET \/api\/runtime\/me 200 ok$/], api: [/^request GET \/api\/me 200 ok$/] }, () => UUID_RE.test(replaced || ""));
  check("correlation.sign-in-and-reads", cor.every((c) => c.ok),
    `${cor.map((c) => `${c.label}: ${c.ok ? "ok" : "MISSING " + traced(c.t)}`).join("; ")} (one correlation ID across the browser response, the Next.js request/upstream/identity lines and the Spring request line; Keycloak is not sent the ID)`);

  /* ---------- an inactive account (twin user_account.status) on a live session, restored at once ---------- */
  const novaAcct = ids.accountId("nova.applicant");
  const status0 = sqlq(`SELECT status FROM app.user_account WHERE id = '${novaAcct}'`);
  let dis;
  try {
    sqlq(`UPDATE app.user_account SET status = 'disabled' WHERE id = '${novaAcct}'`);
    dis = {
      sm: await call(`${API}/api/me`, { token: nova, correlationId: cid("disabled") }),
      sl: await call(`${API}/api/model-applications`, { token: nova, correlationId: cid("disabled") }),
      sd: await call(`${API}/api/model-applications/${NOVA_APP}`, { token: nova, correlationId: cid("disabled") }),
      bm: await call(`${WEB}/api/runtime/me`, { jar: s.jar, correlationId: cid("disabled") }),
      bl: await call(`${WEB}/api/runtime/model-applications`, { jar: s.jar, correlationId: cid("disabled") }),
      bd: await call(`${WEB}/api/runtime/model-applications/${NOVA_APP}`, { jar: s.jar, correlationId: cid("disabled") }),
      bsg: await call(`${WEB}/api/runtime/model-applications/${NOVA_APP}/submit`, { jar: s.jar, correlationId: cid("disabled") }),
      bsp: await call(`${WEB}/api/runtime/model-applications/${NOVA_APP}/submit`, {
        method: "POST", jar: s.jar, correlationId: cid("disabled"), headers: { "Content-Type": "application/json", "Idempotency-Key": "0123456789abcdef0123457" }, body: "{}",
      }),
    };
  } finally {
    sqlq(`UPDATE app.user_account SET status = '${status0}' WHERE id = '${novaAcct}'`);
  }
  const ops = { sm: "/api/me", sl: "/api/model-applications", sd: "/api/model-applications/{id}", bm: "/api/runtime/me", bl: "/api/runtime/model-applications", bd: "/api/runtime/model-applications/{id}", bsg: SUBMIT_ROUTE, bsp: SUBMIT_ROUTE };
  const methods = { sm: "GET", sl: "GET", sd: "GET", bm: "GET", bl: "GET", bd: "GET", bsg: "GET", bsp: "POST" };
  const dise = Object.entries(dis).flatMap(([k, x]) => contract.conforms(doc, ops[k], methods[k], x));
  for (const [k, x] of Object.entries(dis)) {
    if (k.startsWith("bs")) {
      contract.record({ route: ops[k], method: methods[k], status: x.status, code: x.json?.error ?? "-", ok: x.status === 403 && x.json?.error === "no_active_account" && contract.conforms(doc, ops[k], methods[k], x).length === 0 && sameCorr(x) && noStore(x) });
    }
  }
  const disTrace = follows(logs.trace(dis.bl.sent, m0), { web: [/^upstream GET \/api\/model-applications 403 no_active_account$/, /^request GET \/api\/runtime\/model-applications 403 no_active_account$/], api: [/^request GET \/api\/model-applications 403 no_active_account$/] });
  const restored = sqlq(`SELECT status FROM app.user_account WHERE id = '${novaAcct}'`);
  const backAfter = await call(`${WEB}/api/runtime/me`, { jar: s.jar, correlationId: cid("disabled-restored") });
  check("contract.inactive-account", Object.values(dis).every((x) => x.status === 403 && x.json?.error === "no_active_account" && sameCorr(x) && !/LOCAL-MA|NOVA/.test(x.text)) && dise.length === 0 && disTrace && restored === status0 && backAfter.status === 200,
    `test.nova.applicant user_account.status '${status0}' -> 'disabled': Spring me/list/detail ${[dis.sm, dis.sl, dis.sd].map((x) => `${x.status} ${x.json?.error}`).join(", ")}; browser ${[dis.bm, dis.bl, dis.bd].map((x) => `${x.status} ${x.json?.error}`).join(", ")}; correlated through both layers; restored '${restored}', next read ${backAfter.status}${show(dise)}`);

  /* ---------- planted request values: never echoed, never logged ---------- */
  const pr = await plantedRequests(s.jar, nova);

  /* upstream unavailable: stop Spring, check the boundary, start it again */
  const before = await call(`${WEB}/api/runtime/me`, { jar: s.jar, correlationId: cid("next-before") });
  fs.copyFileSync(path.join(LOG_DIR, "api.log"), path.join(LOG_DIR, "api.before-contract-restart.log"));
  let down, health, sessionDuring, after;
  try {
    runtime("stop_api");
    down = await call(`${WEB}/api/runtime/me`, { jar: s.jar, correlationId: cid("next-down") });
    health = await call(`${WEB}/api/runtime/health`, { correlationId: cid("next-down-health") });
    sessionDuring = await call(`${WEB}/api/auth/session`, { jar: s.jar });
    await plantedValues(s.jar, m0);
  } finally {
    runtime("start_api");
  }
  after = await call(`${WEB}/api/runtime/me`, { jar: s.jar, correlationId: cid("next-after") });
  const e = [...contract.conforms(doc, "/api/runtime/me", "GET", down), ...contract.conforms(doc, "/api/runtime/health", "GET", health)];
  check("next.upstream-unavailable", before.status === 200 && down.status === 503 && down.json?.error === "api_unreachable" && sameCorr(down) && noStore(down) && health.status === 503 && health.json?.api === "UNKNOWN" && sessionDuring.json?.authenticated === true && after.status === 200 && e.length === 0,
    `Spring stopped: /api/runtime/me ${down.status} ${down.json?.error}, /api/runtime/health ${health.status} api=${health.json?.api}, session kept; Spring restarted: /api/runtime/me ${after.status}${show(e)}`);
  const dt = logs.trace(down.sent, m0), ht = logs.trace(health.sent, m0), at = logs.trace(after.sent, m0);
  const outageOk = follows(dt, { web: [/^upstream GET \/api\/me 503 api_unreachable$/, /^request GET \/api\/runtime\/me 503 api_unreachable$/] }) && dt.api.length === 0
    && follows(ht, { web: [/^upstream GET \/actuator\/health 503 api_unreachable$/, /^request GET \/api\/runtime\/health 503 api_unreachable$/] }) && ht.api.length === 0
    && follows(at, { web: [/^upstream GET \/api\/me 200 ok$/, /^request GET \/api\/runtime\/me 200 ok$/], api: [/^request GET \/api\/me 200 ok$/] });
  check("correlation.outage", outageOk,
    `Spring down: ${traced(dt)}; health: ${traced(ht)}; after restart: ${traced(at)}`);

  const out = await call(`${WEB}/api/auth/logout`, { method: "POST", jar: s.jar, correlationId: cid("next-logout"), headers: { Origin: WEB } });
  const gone = await call(`${WEB}/api/runtime/me`, { jar: s.jar, correlationId: cid("next-gone") });
  const le = contract.conforms(doc, "/api/auth/logout", "POST", out);
  const lt = logs.trace(out.sent, m0);
  check("next.logout", out.status === 200 && out.json?.keycloakSessionEnded === true && gone.status === 401 && le.length === 0 && sameCorr(out) && follows(lt, { web: [/^identity logout 2\d\d ok$/, /^request POST \/api\/auth\/logout 200 ok$/] }),
    `logout ${out.status} (Keycloak session ended: ${out.json?.keycloakSessionEnded}); then /api/runtime/me ${gone.status} ${gone.json?.error}; ${traced(lt)}${show(le)}`);
  const form = await call(`${WEB}/api/auth/logout`, { method: "POST", correlationId: cid("next-logout-form"), headers: { Origin: WEB, Accept: "text/html" } });
  const fe = contract.conforms(doc, "/api/auth/logout", "POST", form);
  check("next.logout-form", form.status === 303 && /^\/login\b/.test(new URL(form.location, WEB).pathname) && sameCorr(form) && noStore(form) && fe.length === 0,
    `POST /api/auth/logout with Accept: text/html and no session -> ${form.status} ${form.location}${show(fe)}`);

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

  const all = logs.allText(m0);
  const structured = logs.since(m0, "api") + logs.since(m0, "web");
  const responses = webSeen.map((t) => t.split("\n").slice(1).join("\n"));
  const plantedHits = Object.entries(PLANT).flatMap(([k, v]) => [
    ...(all.includes(v) ? [`${k} in a log`] : []),
    ...(responses.some((t) => t.includes(v)) ? [`${k} in a portal response`] : []),
    ...(pr.springSide.some((x) => x.text.includes(v) || [...x.headers.values()].some((h) => h.includes(v))) ? [`${k} in a Spring response`] : []),
  ]);
  const plantedTraces = pr.out.map((o) => logs.trace(o.x.sent, m0).web.find((l) => l.event === "request"));
  const routesOk = plantedTraces.every((l) => l && !/planted|\?/.test(l.route));
  const unsafeId = corr(pr.unsafe);
  check("logs.planted-request-values", plantedHits.length === 0 && routesOk && UUID_RE.test(unsafeId || "") && logs.trace(unsafeId, m0).api.length === 1,
    `${pr.out.length} portal and ${pr.springSide.length} direct Spring requests with planted query values, cookie, bearer, JSON body, path segment, OAuth code/state and an unsafe correlation ID: ${plantedHits.length ? "FOUND " + plantedHits.join(", ") : "none"} in portal or Spring responses (bodies, headers, Location) or any log; logged routes ${[...new Set(plantedTraces.map((l) => l?.route))].join(", ")}; unsafe ID replaced by ${unsafeId} and propagated`);

  const twins = sqlq(`SELECT string_agg(username || '|' || display_name || '|' || keycloak_subject, E'\\n') FROM app.user_account WHERE username LIKE 'test.%'`).split("\n").filter(Boolean);
  const personal = twins.flatMap((r) => { const [u, d, sub] = r.split("|"); return [u, `${u}@bee.local.invalid`, d, sub]; });
  const personalHits = personal.filter((v) => structured.includes(v));
  check("logs.no-personal-data", twins.length >= 5 && personalHits.length === 0,
    `${twins.length} test identities' usernames, emails, display names and Keycloak subjects: ${personalHits.length ? "FOUND " + personalHits.length : "none"} in the structured request logs`);

  const tokenInLog = [...secrets].some((t) => all.includes(t.slice(-40))) || /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(all);
  const codeInLog = /\/api\/auth\/callback\?|[?&](code|state)=[^&\s]+|bee_session=|Set-Cookie|Authorization/i.test(all);
  const problems = logs.problems(m0);
  const n = logs.count(m0);
  check("logs.structured-format", problems.length === 0 && n.api > 40 && n.web > 60,
    `${n.api} Spring and ${n.web} Next.js lines since this run, each one valid against docs/wp03/request-log.schema.json (route templates, no free text)${show(problems)}`);
  check("logs.no-sensitive-data", !tokenInLog && !codeInLog,
    `structured and console logs since this run: tokens ${tokenInLog ? "FOUND" : "absent"}; callback query, code/state, session cookie and Authorization ${codeInLog ? "FOUND" : "absent"}`);
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
