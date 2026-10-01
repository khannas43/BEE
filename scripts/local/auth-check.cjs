/* eslint-disable */
/**
 * WP02.1 sign-in checks against the running local runtime. Drives the real
 * browser flow over HTTP (Next.js login route -> Keycloak login form -> callback)
 * with a browser-like cookie jar, then checks Spring's answer and the session.
 *
 *   node scripts/local/auth-check.cjs [--with-expiry]
 *
 * --with-expiry waits for the 60 s access tokens to run out (about a minute).
 * Appends JSON lines to $AUTH_RESULTS when set (used by local:check).
 */
const fs = require("fs");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");

const env = (k, d) => process.env[k] || d;
const WEB = `http://127.0.0.1:${env("BEE_WEB_PORT", "3100")}`;
const KC = `http://127.0.0.1:${env("BEE_KC_PORT", "8180")}`;
const API = `http://127.0.0.1:${env("BEE_API_PORT", "8090")}`;
const REALM = env("BEE_REALM", "bee-local");
const ISSUER = `${KC}/realms/${REALM}`;
const PASSWORD = env("BEE_DEV_USER_PASSWORD", "bee-local-dev");
const ADMIN_PASSWORD = env("BEE_KC_ADMIN_PASSWORD", "bee-local-admin");
const WITH_EXPIRY = process.argv.includes("--with-expiry");
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const user = (n) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const IDS = { "nova.applicant": user(1), "pixel.applicant": user(2), "no.account": user(14), "inactive.role": user(15), "role.mismatch": user(16) };

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(34)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}

/* ---------- browser-like cookie jar: cookies are per host, not per port ---------- */
class Jar {
  constructor() { this.c = new Map(); }
  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq), value = pair.slice(eq + 1);
      const a = Object.fromEntries(attrs.map((x) => { const i = x.indexOf("="); return i < 0 ? [x.toLowerCase(), true] : [x.slice(0, i).toLowerCase(), x.slice(i + 1)]; }));
      const path = a.path || "/";
      const key = `${name}|${path}`;
      if (a["max-age"] === "0" || value === "" || (a.expires && new Date(a.expires) < new Date())) this.c.delete(key);
      else this.c.set(key, { name, value, path });
    }
  }
  header(url) {
    const p = new URL(url).pathname;
    return [...this.c.values()].filter((k) => p.startsWith(k.path)).map((k) => `${k.name}=${k.value}`).join("; ");
  }
  get(name) { return [...this.c.values()].find((k) => k.name === name)?.value; }
  set(name, value, path = "/") { this.c.set(`${name}|${path}`, { name, value, path }); }
  drop(name) { for (const [k, v] of this.c) if (v.name === name) this.c.delete(k); }
}

/** Everything the portal (port 3100) sends the browser, for the token scan. */
const webExposure = [];
async function req(jar, url, init = {}) {
  const headers = { ...(init.headers || {}) };
  const cookie = jar ? jar.header(url) : "";
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(20000) });
  if (jar) jar.store(res);
  const body = await res.text();
  if (url.startsWith(WEB)) webExposure.push({ url, status: res.status, headers: [...res.headers.entries()], setCookie: res.headers.getSetCookie(), body });
  let json = null;
  try { json = JSON.parse(body); } catch {}
  return { status: res.status, location: res.headers.get("location"), setCookie: res.headers.getSetCookie(), body, json };
}
const abs = (loc, base) => new URL(loc, base).toString();
const decodeHtml = (s) => s.replace(/&amp;/g, "&").replace(/&#x3D;/g, "=").replace(/&quot;/g, '"');

/** Starts login and returns the Keycloak login form action, or a redirect if Keycloak skipped the form (SSO). */
async function startLogin(jar, returnTo = "/app") {
  const r1 = await req(jar, `${WEB}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  const loginCookie = r1.setCookie.find((c) => c.startsWith("bee_login="));
  const authUrl = r1.location;
  const r2 = await req(jar, authUrl);
  const action = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(r2.body)?.[1];
  return { r1, loginCookie, authUrl, form: action ? decodeHtml(action) : null, ssoRedirect: r2.status === 302 ? r2.location : null };
}
/** Submits credentials, then the TOTP code Keycloak asks for; returns the callback URL Keycloak redirects to. */
async function submitCredentials(jar, form, username) {
  const r = await req(jar, form, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ username, password: PASSWORD, credentialId: "" }) });
  return (await totp.completeLogin((url, init) => req(jar, url, init), r, username)).location ?? null;
}
async function signIn(username, jar = new Jar()) {
  const s = await startLogin(jar);
  const callback = s.form ? await submitCredentials(jar, s.form, username) : s.ssoRedirect;
  const cb = callback ? await req(jar, callback) : null;
  return { jar, start: s, callback, cb, final: cb?.location ?? null, sessionSetCookie: cb?.setCookie.find((c) => c.startsWith("bee_session=")) ?? null };
}
const me = (jar, extra = {}) => req(jar, `${WEB}/api/runtime/me`, extra);
const session = (jar) => req(jar, `${WEB}/api/auth/session`);
const errorOf = (loc) => (loc ? new URL(loc, WEB).searchParams.get("error") : null);

async function adminToken() {
  const r = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: "admin", password: ADMIN_PASSWORD }) });
  return (await r.json()).access_token;
}
async function kcSessions(username) {
  const r = await fetch(`${KC}/admin/realms/${REALM}/users/${IDS[username]}/sessions`, { headers: { Authorization: `Bearer ${await adminToken()}` } });
  return (await r.json()).length;
}
async function kcLogoutUser(username) {
  await fetch(`${KC}/admin/realms/${REALM}/users/${IDS[username]}/logout`, { method: "POST", headers: { Authorization: `Bearer ${await adminToken()}` } });
}
function sql(statement) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${env("BEE_APP_DB_PASSWORD", "bee-local-app")}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", statement]).toString().trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const attr = (setCookie, name) => new RegExp(`;\\s*${name}(=|;|$)`, "i").test(setCookie || "");

(async () => {
  for (const u of ["nova.applicant", "pixel.applicant", "no.account", "inactive.role", "role.mismatch"]) await totp.ensureEnrolled(u);

  /* ---------- no session ---------- */
  let r = await me(new Jar());
  check("auth.no-session-me", r.status === 401 && r.json?.error === "no_session", `GET /api/runtime/me without cookie: HTTP ${r.status} ${r.json?.error}`);
  r = await session(new Jar());
  check("auth.no-session-status", r.status === 200 && r.json?.authenticated === false, `GET /api/auth/session: ${r.body}`);
  const forged = new Jar(); forged.set("bee_session", "Zm9yZ2VkLXNlc3Npb24taWQtdGhhdC13YXMtbmV2ZXItaXNzdWVk");
  r = await me(forged);
  check("auth.forged-cookie", r.status === 401 && r.json?.error === "no_session" && r.setCookie.some((c) => /^bee_session=;/.test(c)), `made-up session id: HTTP ${r.status} ${r.json?.error}, cookie cleared`);
  const pw = (await totp.passwordGrant("nova.applicant")).json;
  r = await me(new Jar(), { headers: { Authorization: `Bearer ${pw.access_token}` } });
  check("auth.browser-bearer-ignored", r.status === 401 && r.json?.error === "no_session", `valid bearer token from the browser, no cookie: HTTP ${r.status} ${r.json?.error}`);

  /* ---------- successful sign-in: Nova ---------- */
  const nova = await signIn("nova.applicant");
  const s1 = nova.start;
  const authQ = new URL(s1.authUrl).searchParams;
  check("auth.login-redirect", s1.r1.status === 303 && s1.authUrl.startsWith(`${ISSUER}/protocol/openid-connect/auth`) && authQ.get("code_challenge_method") === "S256" && authQ.get("state") && authQ.get("nonce") && !authQ.get("code_verifier"),
    `303 to Keycloak; response_type=${authQ.get("response_type")} client=${authQ.get("client_id")} PKCE=${authQ.get("code_challenge_method")} state+nonce present, verifier absent`);
  check("auth.login-cookie", attr(s1.loginCookie, "HttpOnly") && /path=\/api\/auth\/callback/i.test(s1.loginCookie) && /samesite=lax/i.test(s1.loginCookie) && !JWT.test(s1.loginCookie),
    `bee_login: HttpOnly, SameSite=Lax, Path=/api/auth/callback, Max-Age=${/max-age=(\d+)/i.exec(s1.loginCookie)?.[1]}`);
  check("auth.nova-signed-in", nova.final === "/app" || nova.final === `${WEB}/app`, `callback HTTP ${nova.cb?.status} -> ${nova.final}`);
  const sc = nova.sessionSetCookie || "";
  const sid = /^bee_session=([^;]*)/.exec(sc)?.[1] || "";
  check("auth.session-cookie", attr(sc, "HttpOnly") && /samesite=lax/i.test(sc) && /path=\/(;|$)/i.test(sc) && /^[A-Za-z0-9_-]{43}$/.test(sid) && !JWT.test(sid),
    `bee_session: HttpOnly, SameSite=Lax, Path=/, opaque ${sid.length}-char random id (not a JWT)${attr(sc, "Secure") ? ", Secure" : ", not Secure (http on 127.0.0.1)"}`);
  r = await me(nova.jar);
  const orgs = (r.json?.organisations || []).map((o) => o.code).join(",");
  const roles = (r.json?.effectiveRoles || []).map((x) => `${x.role}/${x.scope}`).join(",");
  check("auth.nova-me", r.status === 200 && orgs === "NOVA" && roles === "manufacturer/own-org" && r.json?.authority === "spring-database", `HTTP ${r.status} orgs=${orgs} roles=${roles} authority=${r.json?.authority}`);
  const claim = r.json?.ignoredTokenClaims?.organisation;
  check("auth.nova-org-claim-ignored", claim === "Bureau of Energy Efficiency (local)" && orgs === "NOVA", `token claims organisation '${claim}'; Spring returned NOVA from its database`);
  r = await session(nova.jar);
  check("auth.session-view-no-tokens", r.json?.authenticated === true && r.json?.username === "nova.applicant" && !JWT.test(r.body) && !/token"\s*:/i.test(r.body), `GET /api/auth/session: ${r.body}`);

  /* ---------- PixelCert ---------- */
  const pixel = await signIn("pixel.applicant");
  r = await me(pixel.jar);
  const porgs = (r.json?.organisations || []).map((o) => o.code).join(",");
  check("auth.pixel-signed-in", (pixel.final || "").endsWith("/app") && r.status === 200 && porgs === "PIXEL" && (r.json?.effectiveRoles || []).map((x) => `${x.role}/${x.scope}`).join(",") === "agency/own-org",
    `-> ${pixel.final}; /api/runtime/me HTTP ${r.status} orgs=${porgs}; token org claim '${r.json?.ignoredTokenClaims?.organisation}' ignored`);

  /* ---------- Keycloak accepts, Spring refuses: no session is created ---------- */
  for (const [u, want] of [["no.account", "no_active_account"], ["inactive.role", "no_effective_role"], ["role.mismatch", "no_effective_role"]]) {
    const kcBefore = await kcSessions(u);
    const x = await signIn(u);
    const m = await me(x.jar);
    const kc = await kcSessions(u);
    check(`auth.denied.${u}`, errorOf(x.final) === want && !x.sessionSetCookie && m.status === 401 && kc === kcBefore,
      `Keycloak login ok; callback -> /login?error=${errorOf(x.final)}; no session cookie; /api/runtime/me ${m.status}; Keycloak session from this sign-in ended (${kcBefore} -> ${kc})`);
  }

  /* ---------- callback validation ---------- */
  {
    const jar = new Jar();
    const s = await startLogin(jar);
    const cb = new URL(await submitCredentials(jar, s.form, "nova.applicant"));
    const good = cb.toString();
    cb.searchParams.set("state", "tampered-state");
    r = await req(jar, cb.toString());
    check("auth.callback-state-tampered", errorOf(r.location) === "invalid_state" && !r.setCookie.some((c) => c.startsWith("bee_session=") && !/^bee_session=;/.test(c)), `state altered: -> /login?error=${errorOf(r.location)}, no session`);
    r = await req(jar, good);
    check("auth.callback-one-time", errorOf(r.location) === "login_expired", `same login used again after a failed callback: -> error=${errorOf(r.location)} (transaction consumed)`);
  }
  {
    const jar = new Jar();
    const s = await startLogin(jar);
    const cb = new URL(await submitCredentials(jar, s.form, "nova.applicant"));
    cb.searchParams.set("iss", "http://127.0.0.1:8180/realms/master");
    r = await req(jar, cb.toString());
    check("auth.callback-issuer", errorOf(r.location) === "invalid_issuer", `iss altered: -> error=${errorOf(r.location)}`);
  }
  {
    const victim = new Jar(), attacker = new Jar();
    await startLogin(victim);
    const a = await startLogin(attacker);
    const attackerCallback = await submitCredentials(attacker, a.form, "pixel.applicant");
    r = await req(victim, attackerCallback);
    check("auth.callback-login-csrf", errorOf(r.location) === "invalid_state" && !victim.get("bee_session"), `another browser's code+state replayed into this browser: -> error=${errorOf(r.location)}, no session`);
    r = await req(new Jar(), attackerCallback);
    check("auth.callback-no-login-cookie", errorOf(r.location) === "login_expired", `callback without the login cookie: -> error=${errorOf(r.location)}`);
  }
  r = await req(nova.jar, nova.callback);
  check("auth.callback-replay", errorOf(r.location) === "login_expired", `successful callback URL replayed: -> error=${errorOf(r.location)}`);

  /* ---------- Spring stays the authority during a session ---------- */
  sql(`UPDATE app.role_assignment SET active = false WHERE user_id = '${IDS["nova.applicant"]}'`);
  try {
    r = await me(nova.jar);
    check("auth.midsession-role-revoked", r.status === 403 && r.json?.error === "no_effective_role", `role deactivated in Spring while signed in: HTTP ${r.status} ${r.json?.error}`);
  } finally {
    sql(`UPDATE app.role_assignment SET active = true WHERE user_id = '${IDS["nova.applicant"]}'`);
  }
  r = await me(nova.jar);
  check("auth.midsession-role-restored", r.status === 200, `role reactivated: HTTP ${r.status}`);

  /* ---------- expiry and refresh ---------- */
  if (WITH_EXPIRY) {
    const a = await signIn("nova.applicant");
    const b = await signIn("pixel.applicant");
    const before = (await session(a.jar)).json;
    await kcLogoutUser("pixel.applicant");
    const waitMs = Math.max(0, new Date(before.accessExpiresAt).getTime() - Date.now() - 10_000);
    console.log(`     waiting ${Math.round(waitMs / 1000)} s for the access tokens to near expiry...`);
    await sleep(waitMs);
    r = await me(a.jar);
    const after = (await session(a.jar)).json;
    check("auth.refresh", r.status === 200 && after.refreshCount === before.refreshCount + 1 && after.accessExpiresAt > before.accessExpiresAt, `access token near expiry: /api/runtime/me ${r.status}; refreshCount ${before.refreshCount} -> ${after.refreshCount}; new expiry ${after.accessExpiresAt}`);
    r = await me(b.jar);
    check("auth.expired-session", r.status === 401 && r.json?.error === "session_expired" && r.setCookie.some((c) => /^bee_session=;/.test(c)), `Keycloak session ended by admin, then refresh refused: HTTP ${r.status} ${r.json?.error}, cookie cleared`);
    r = await me(b.jar);
    check("auth.expired-session-gone", r.status === 401 && r.json?.error === "no_session", `next request: HTTP ${r.status} ${r.json?.error}`);
  }

  /* ---------- logout ---------- */
  const oldSid = nova.jar.get("bee_session");
  r = await req(nova.jar, `${WEB}/api/auth/logout`, { method: "POST", headers: { Origin: "http://127.0.0.1:3000" } });
  const still = await me(nova.jar);
  check("auth.logout-cross-origin", r.status === 403 && still.status === 200, `POST from http://127.0.0.1:3000 (same site, other port): HTTP ${r.status}; session still valid (${still.status})`);
  r = await req(nova.jar, `${WEB}/api/auth/logout`, { method: "GET" });
  check("auth.logout-get-refused", r.status === 405, `GET /api/auth/logout: HTTP ${r.status}`);
  const kcBefore = await kcSessions("nova.applicant");
  r = await req(nova.jar, `${WEB}/api/auth/logout`, { method: "POST", headers: { Origin: WEB } });
  const kcAfter = await kcSessions("nova.applicant");
  // Other nova sessions belong to the callback tests' browsers, whose sign-in the portal refused.
  check("auth.logout", r.status === 200 && r.json?.signedOut && r.json?.keycloakSessionEnded && r.setCookie.some((c) => /^bee_session=;/.test(c)) && kcAfter === kcBefore - 1,
    `HTTP ${r.status} ${r.body}; cookie cleared; this browser's Keycloak session ended (nova sessions ${kcBefore} -> ${kcAfter})`);
  const reuse = new Jar(); reuse.set("bee_session", oldSid);
  r = await me(reuse);
  check("auth.logout-cookie-dead", r.status === 401 && r.json?.error === "no_session", `old session id sent again: HTTP ${r.status} ${r.json?.error}`);
  const again = await startLogin(nova.jar);
  check("auth.logout-ends-sso", Boolean(again.form) && !again.ssoRedirect, `next sign-in shows the Keycloak login form again (no silent SSO)`);
  r = await req(new Jar(), `${WEB}/api/auth/logout`, { method: "POST", headers: { Origin: WEB, Accept: "text/html" } });
  check("auth.logout-form-redirect", r.status === 303 && r.location?.endsWith("/login?signedOut=1"), `form POST without a session: ${r.status} -> ${r.location}`);
  for (const u of ["nova.applicant", "pixel.applicant"]) await kcLogoutUser(u);

  /* ---------- no token reaches the browser ---------- */
  const page = await req(pixel.jar, `${WEB}/app`);
  const leaks = webExposure.filter((e) => JWT.test(e.body) || e.headers.some(([k, v]) => JWT.test(v)));
  check("auth.no-token-in-responses", leaks.length === 0, `${webExposure.length} portal responses scanned (redirects, cookies, JSON, /app HTML ${page.status}); JWT-shaped values found: ${leaks.length}${leaks.length ? " in " + leaks.map((l) => l.url).join(", ") : ""}`);
  const script = webExposure.flatMap((e) => e.setCookie).filter((c) => !attr(c, "HttpOnly"));
  check("auth.no-script-readable-cookie", script.length === 0, `portal Set-Cookie headers without HttpOnly: ${script.length}`);

  console.log(`auth checks: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  check("auth.run", false, `aborted: ${e.message}`);
  process.exit(1);
});
