// WP03.3: structured request logs, retention, and the conditions that cannot be induced in
// the shared runtime (Keycloak unreachable or refusing, planted Keycloak and callback values),
// exercised through the real route handlers with a stubbed fetch.
// Run: npm run web:test (needs --import ./scripts/local/test-resolve.mjs)
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const LOG_DIR = mkdtempSync(join(tmpdir(), "bee-request-log-"));
process.env.BEE_LOG_DIR = LOG_DIR;
const ISSUER = "http://127.0.0.1:8180/realms/bee-local";
const SECRET = "planted-secret-5e2a";
const logSchema = JSON.parse(readFileSync(new URL("../../docs/wp03/request-log.schema.json", import.meta.url), "utf8"));
const contract = JSON.parse(readFileSync(new URL("../../docs/wp03/bee-local-api.openapi.json", import.meta.url), "utf8"));
const lib = createRequire(import.meta.url)("./contract-lib.cjs");

let NextRequest, routes, session, requestLog;
before(async () => {
  ({ NextRequest } = await import("next/server"));
  requestLog = await import("../../lib/server/requestLog.ts");
  session = await import("../../lib/server/session.ts");
  routes = {
    me: await import("../../app/api/runtime/me/route.ts"),
    list: await import("../../app/api/runtime/model-applications/route.ts"),
    detail: await import("../../app/api/runtime/model-applications/[id]/route.ts"),
    login: await import("../../app/api/auth/login/route.ts"),
    callback: await import("../../app/api/auth/callback/route.ts"),
    health: await import("../../app/api/runtime/health/route.ts"),
  };
});

const lines = () => readFileSync(join(LOG_DIR, "web-requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const byCorrelation = (id) => lines().filter((l) => l.correlationId === id);
const req = (path, id, cookie) => new NextRequest(`http://127.0.0.1:3100${path}`, { headers: { "x-correlation-id": id, ...(cookie ? { cookie: `bee_session=${cookie}` } : {}) } });
const seen = [];
function stubFetch(handler) {
  globalThis.fetch = async (url, init) => {
    seen.push(String(url));
    return handler(String(url), init);
  };
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
/** A session whose access token is inside the refresh leeway, so the next read refreshes it. */
const nearExpiry = () => session.createSession("00000000-0000-4000-a000-000000000001", "nova.applicant", { access_token: `access-${SECRET}`, refresh_token: `refresh-${SECRET}`, expires_in: 1, refresh_expires_in: 0 }, ["pwd", "otp"]).cookie;
const calls = [
  ["/api/runtime/me", (r) => routes.me.GET(r)],
  ["/api/runtime/model-applications", (r) => routes.list.GET(r)],
  ["/api/runtime/model-applications/{id}", (r) => routes.detail.GET(r, { params: Promise.resolve({ id: "00000000-0000-4000-c000-000000000002" }) })],
];
const path = (route) => route.replace("{id}", "00000000-0000-4000-c000-000000000002");

test("Keycloak unreachable at sign-in start: 303 to identity_unavailable, logged under the request's correlation ID", async () => {
  stubFetch(async () => { throw new TypeError("fetch failed"); });
  const res = await routes.login.GET(req("/api/auth/login?returnTo=/app", "unit-login-down"));
  assert.equal(res.status, 303);
  assert.equal(new URL(res.headers.get("location")).search, "?error=identity_unavailable");
  assert.equal(res.headers.get("x-correlation-id"), "unit-login-down");
  const l = byCorrelation("unit-login-down");
  assert.deepEqual(l.map((x) => [x.event, x.operation ?? x.route, x.status, x.outcome]), [["identity", "discovery", 0, "unreachable"], ["request", "/api/auth/login", 303, "identity_unavailable"]]);
});

test("Keycloak unreachable during refresh: 503 identity_unavailable on every session read, session kept, Spring not called", async () => {
  stubFetch(async () => { throw new TypeError("fetch failed"); });
  const cookie = nearExpiry();
  for (const [route, call] of calls) {
    seen.length = 0;
    const id = `unit-idp-down-${route.length}`;
    const res = await call(req(path(route), id, cookie));
    const body = await res.json();
    assert.equal(res.status, 503, route);
    assert.deepEqual(body, { error: "identity_unavailable", message: contract["x-bee-error-codes"].identity_unavailable.message });
    assert.deepEqual(lib.conforms(contract, route, "GET", { status: res.status, headers: res.headers, json: body }), [], route);
    assert.equal(res.headers.get("set-cookie"), null, "the session cookie is not cleared");
    assert.equal(seen.some((u) => u.includes(":8090")), false, "Spring is not called");
    assert.deepEqual(byCorrelation(id).map((x) => [x.event, x.operation ?? x.route, x.outcome]), [["identity", "discovery", "unreachable"], ["request", route, "identity_unavailable"]]);
  }
  assert.ok(session.readSession(cookie), "session still present");
});

const discovery = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, end_session_endpoint: `${ISSUER}/logout`, jwks_uri: `${ISSUER}/certs` };

test("Keycloak refusing the refresh with planted text: 401 session_expired or 503, only a fixed outcome logged", async () => {
  stubFetch(async (url) => (url.endsWith("openid-configuration") ? json(200, discovery) : json(400, { error: "invalid_grant", error_description: `Token is not active ${SECRET}` })));
  let cookie = nearExpiry();
  let res = await routes.list.GET(req("/api/runtime/model-applications", "unit-refresh-refused", cookie));
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "session_expired");
  assert.match(res.headers.get("set-cookie") ?? "", /^bee_session=;/);
  assert.deepEqual(byCorrelation("unit-refresh-refused").map((x) => [x.event, x.operation ?? x.route, x.status, x.outcome]),
    [["identity", "discovery", 200, "ok"], ["identity", "token.refresh", 400, "invalid_grant"], ["request", "/api/runtime/model-applications", 401, "session_expired"]]);

  stubFetch(async () => json(500, { error: `${SECRET} SELECT password_hash`, error_description: SECRET }));
  cookie = nearExpiry();
  res = await routes.me.GET(req("/api/runtime/me", "unit-refresh-500", cookie));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "identity_unavailable");
  assert.deepEqual(byCorrelation("unit-refresh-500").map((x) => [x.event, x.operation ?? x.route, x.status, x.outcome]),
    [["identity", "token.refresh", 500, "refused"], ["request", "/api/runtime/me", 503, "identity_unavailable"]]);
});

test("a callback with a planted code, state and session_state logs only the route, status and redirect code", async () => {
  stubFetch(async () => { throw new Error("no Keycloak or Spring call expected"); });
  seen.length = 0;
  const res = await routes.callback.GET(req(`/api/auth/callback?code=${SECRET}&state=${SECRET}&session_state=${SECRET}&iss=${SECRET}`, "unit-callback"));
  assert.equal(res.status, 303);
  assert.equal(new URL(res.headers.get("location")).search, "?error=login_expired");
  assert.equal(seen.length, 0);
  assert.deepEqual(byCorrelation("unit-callback").map((x) => [x.route, x.status, x.outcome]), [["/api/auth/callback", 303, "login_expired"]]);
});

test("Spring errors passed through, rejected or unreachable are logged with the contract code on both lines", async () => {
  const fresh = session.createSession("00000000-0000-4000-a000-000000000001", "nova.applicant", { access_token: `access-${SECRET}`, refresh_token: `refresh-${SECRET}`, expires_in: 300, refresh_expires_in: 0 }, ["pwd", "otp"]).cookie;
  const answer = { body: null };
  stubFetch(async (url) => {
    if (!url.includes(":8090")) throw new Error("no Keycloak call expected");
    if (answer.body === "down") throw new TypeError("fetch failed");
    return json(answer.body[0], answer.body[1]);
  });
  const cases = [
    [[403, { error: "no_read_scope", message: contract["x-bee-error-codes"].no_read_scope.message }], 403, "no_read_scope", "no_read_scope"],
    [[404, { error: "not_found", message: contract["x-bee-error-codes"].not_found.message }], 404, "not_found", "not_found"],
    [[403, { error: `${SECRET} SELECT password_hash`, message: SECRET }], 502, "api_error", "unlisted"],
    ["down", 503, "api_unreachable", "api_unreachable"],
  ];
  for (const [body, status, code, upstream] of cases) {
    answer.body = body;
    const id = `unit-spring-${code.replaceAll("_", "-")}`;
    const res = await routes.detail.GET(req(path("/api/runtime/model-applications/{id}"), id, fresh), { params: Promise.resolve({ id: "00000000-0000-4000-c000-000000000002" }) });
    assert.equal(res.status, status);
    assert.equal((await res.json()).error, code);
    assert.deepEqual(byCorrelation(id).map((x) => [x.event, x.route, x.status, x.outcome]),
      [["upstream", "/api/model-applications/{id}", body === "down" ? 503 : body[0], upstream], ["request", "/api/runtime/model-applications/{id}", status, code]]);
  }
  answer.body = "down";
  const res = await routes.health.GET(req("/api/runtime/health", "unit-health-down"));
  assert.equal(res.status, 503);
  assert.deepEqual(byCorrelation("unit-health-down").map((x) => [x.event, x.route, x.status, x.outcome]),
    [["upstream", "/actuator/health", 503, "api_unreachable"], ["request", "/api/runtime/health", 503, "api_unreachable"]]);
  answer.body = [503, { status: "DOWN", components: { db: { status: "DOWN" } } }];
  await routes.health.GET(req("/api/runtime/health", "unit-health-503"));
  assert.deepEqual(byCorrelation("unit-health-503").map((x) => [x.event, x.status, x.outcome]), [["upstream", 503, "unlisted"], ["request", 503, "api_down"]]);
});

test("every line written in this file matches the documented format, and no planted or personal value was written", () => {
  const text = readFileSync(join(LOG_DIR, "web-requests.jsonl"), "utf8");
  for (const l of lines()) assert.deepEqual(lib.validate(logSchema.line, l, logSchema), [], JSON.stringify(l));
  for (const v of [SECRET, "nova.applicant", "password_hash", "Token is not active", "returnTo", "/app"]) assert.equal(text.includes(v), false, v);
});

test("unsafe values never reach a line: method, outcome and Spring paths are reduced to fixed words", () => {
  assert.equal(requestLog.safeMethod("GET"), "GET");
  assert.equal(requestLog.safeMethod(`X-${SECRET}`), "OTHER");
  assert.equal(requestLog.safeOutcome("not_found"), "not_found");
  for (const bad of [SECRET, "SELECT x", "", 7, null, "a".repeat(41)]) assert.equal(requestLog.safeOutcome(bad), "unlisted");
  assert.equal(requestLog.springRoute(`/api/model-applications/${SECRET}?code=${SECRET}`), "/api/model-applications/{id}");
  assert.equal(requestLog.springRoute("/api/me?x=1"), "/api/me");
  assert.equal(requestLog.identityOutcome(false, SECRET), "refused");
  assert.equal(requestLog.identityOutcome(false, "invalid_grant"), "invalid_grant");
});

test("retention: the file rotates at its size limit, keeps at most 3 rotated files, and drops old ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "bee-rotate-"));
  const line = { event: "request", correlationId: "rot-1", method: "GET", route: "/api/runtime/me", status: 200, outcome: "ok", durationMs: 1 };
  for (let i = 0; i < 60; i++) requestLog.writeLogLine(line, dir, 600);
  let files = readdirSync(dir).sort();
  assert.deepEqual(files, ["web-requests.1.jsonl", "web-requests.2.jsonl", "web-requests.3.jsonl", "web-requests.jsonl"]);
  for (const f of files) assert.ok(statSync(join(dir, f)).size <= 600, f);
  const old = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(join(dir, "web-requests.2.jsonl"), old, old);
  writeFileSync(join(dir, "web-requests.9.jsonl"), "{}\n");
  requestLog.prune(dir);
  files = readdirSync(dir).sort();
  assert.deepEqual(files, ["web-requests.1.jsonl", "web-requests.3.jsonl", "web-requests.jsonl"]);
});
