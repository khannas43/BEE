/* eslint-disable */
/**
 * WP02.3 local TOTP checks against the running runtime, through the real portal
 * (Next.js login route -> Keycloak -> callback) and the real Keycloak pages.
 *
 *   node scripts/local/mfa-check.cjs              full run (about 1.5 minutes; waits for unused TOTP steps)
 *   node scripts/local/mfa-check.cjs --realm-only realm policy and enrollment state only (read-only)
 *
 * Never touches the seeded users. Enrollment, wrong-code, replay, logout and retry tests
 * run as disposable, un-enrolled twins `mfa.<persona>` (scripts/local/test-identities.cjs)
 * with the persona's Keycloak role and bee_app rows, removed afterwards. The realm-flow
 * misconfiguration test is separate: scripts/local/mfa-misbind-check.cjs. Secrets go to
 * git-ignored .local/run/totp/. Appends JSON lines to $AUTH_RESULTS when set.
 */
const fs = require("fs");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { USERS } = require("../../local/generate-fixtures.cjs");

const env = (k, d) => process.env[k] || d;
const WEB = `http://127.0.0.1:${env("BEE_WEB_PORT", "3100")}`;
const KC = `http://127.0.0.1:${env("BEE_KC_PORT", "8180")}`;
const PASSWORD = env("BEE_DEV_USER_PASSWORD", "bee-local-dev");
const REALM_ONLY = process.argv.includes("--realm-only");
/** The disposable twin used for a persona. */
const M = (persona) => ids.name(persona, "mfa");

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(34)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}

/* ---------- browser-like client: cookies per host (not port), no redirect following ---------- */
class Browser {
  constructor() { this.c = new Map(); }
  async req(url, init = {}) {
    const u = new URL(url);
    const cookie = [...this.c.entries()].filter(([k]) => k.startsWith(u.hostname + "|")).map(([k, v]) => `${k.split("|")[1]}=${v}`).join("; ");
    const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), ...(cookie ? { Cookie: cookie } : {}) }, redirect: "manual", signal: AbortSignal.timeout(20000) });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const i = pair.indexOf("="), name = pair.slice(0, i), value = pair.slice(i + 1);
      const key = `${u.hostname}|${name}`;
      if (!value || attrs.some((a) => /^max-age=0$/i.test(a))) this.c.delete(key); else this.c.set(key, value);
    }
    const body = await res.text();
    let json = null;
    try { json = JSON.parse(body); } catch {}
    return { status: res.status, location: res.headers.get("location") ? new URL(res.headers.get("location"), url).toString() : null, body, json };
  }
  has(name) { return [...this.c.keys()].some((k) => k.endsWith(`|${name}`)); }
  /** Follows redirects that stay inside Keycloak's login pages. */
  async settle(r) {
    for (let i = 0; i < 5 && (r.status === 302 || r.status === 303) && r.location.startsWith(KC) && r.location.includes("/login-actions/"); i++) r = await this.req(r.location);
    return r;
  }
}
const post = (o) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o) });

/** Portal login up to the first Keycloak page after the password (or an SSO redirect). */
async function startAndPassword(b, username) {
  const r1 = await b.req(`${WEB}/api/auth/login?returnTo=/app`);
  const q = new URL(r1.location).searchParams;
  const pkce = q.get("code_challenge_method") === "S256" && !!q.get("state") && !!q.get("nonce");
  const r2 = await b.req(r1.location);
  if (r2.status === 302) return { pkce, sso: r2.location, page: null };
  const login = totp.page(r2.body);
  if (login.kind !== "login") throw new Error(`expected the Keycloak login form, got ${login.kind}`);
  const r3 = await b.settle(await b.req(login.action, post({ username, password: PASSWORD, credentialId: "" })));
  return { pkce, sso: null, response: r3, page: r3.status === 200 ? totp.page(r3.body) : null };
}
const finishAtPortal = async (b, r) => {
  r = await b.settle(r);
  if (!(r.status === 302 && r.location.startsWith(`${WEB}/api/auth/callback`))) return { callback: null, final: null };
  const cb = await b.req(r.location);
  return { callback: r.location, final: cb.location, cb };
};
const sessionOf = async (b) => (await b.req(`${WEB}/api/auth/session`)).json;
const logout = (b) => b.req(`${WEB}/api/auth/logout`, { method: "POST", headers: { Origin: WEB } });
/** Keycloak sessions this user holds with the portal client (password-grant check sessions are separate). */
const kcSessions = async (u) => (await totp.admin(`/users/${await totp.userId(u)}/sessions`)).filter((s) => Object.values(s.clients || {}).includes("bee-web")).length;
const errorOf = (loc) => (loc ? new URL(loc).searchParams.get("error") : null);
const amrOf = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")).amr;

async function realmChecks() {
  const realm = await totp.admin("");
  const browser = await totp.admin(`/authentication/flows/${encodeURIComponent(realm.browserFlow)}/executions`);
  const grant = await totp.admin(`/authentication/flows/${encodeURIComponent(realm.directGrantFlow)}/executions`);
  const otpBrowser = browser.find((e) => e.providerId === "auth-otp-form");
  const otpGrant = grant.find((e) => e.providerId === "direct-grant-validate-otp");
  check("mfa.realm-policy", realm.browserFlow === "bee browser with otp" && realm.directGrantFlow === "bee direct grant with otp" && otpBrowser?.requirement === "REQUIRED" && otpGrant?.requirement === "REQUIRED" && realm.otpPolicyCodeReusable === false && realm.otpPolicyType === "totp",
    `browser="${realm.browserFlow}" (OTP Form ${otpBrowser?.requirement}); direct grant="${realm.directGrantFlow}" (OTP ${otpGrant?.requirement}); ${realm.otpPolicyType}/${realm.otpPolicyAlgorithm}/${realm.otpPolicyDigits} digits/${realm.otpPolicyPeriod}s, look-around ${realm.otpPolicyLookAheadWindow}, reusable ${realm.otpPolicyCodeReusable}`);
  const states = [];
  for (const u of USERS) {
    const id = await totp.userId(u.username);
    const user = await totp.admin(`/users/${id}`);
    const creds = (await totp.admin(`/users/${id}/credentials`)).filter((c) => c.type === "otp").length;
    states.push({ u: u.username, enrolled: creds > 0, pending: (user.requiredActions || []).includes("CONFIGURE_TOTP") });
  }
  const uncovered = states.filter((s) => !s.enrolled && !s.pending);
  check("mfa.every-user-covered", uncovered.length === 0,
    `${states.length} seeded Keycloak users: ${states.filter((s) => s.enrolled).length} enrolled, ${states.filter((s) => !s.enrolled && s.pending).length} with CONFIGURE_TOTP pending, ${uncovered.length} neither${uncovered.length ? ": " + uncovered.map((s) => s.u).join(", ") : ""} (with OTP REQUIRED in the flow, an unenrolled user is forced to enroll)`);
  return states;
}

/** p: seeded persona; the test runs as its un-enrolled twin. Check ids keep the persona name. */
async function enrollAndChallenge(persona, org) {
  const u = M(persona);
  const b = new Browser();

  /* enrollment is required before any portal session exists */
  let s = await startAndPassword(b, u);
  check(`mfa.${persona}.enrollment-required`, s.pkce && s.page?.kind === "totp-setup" && !!s.page.secret && !b.has("bee_session") && (await sessionOf(b)).authenticated === false,
    `password accepted, then Keycloak's TOTP setup page (PKCE S256, state, nonce sent); no portal session yet`);
  totp.save(u, { secret: s.page.secret, enrolledAt: new Date().toISOString(), lastStep: -1 });
  let r = await b.req(s.page.action, post({ totp: "", totpSecret: s.page.secret, userLabel: "local-check" }));
  let p = totp.page(r.body);
  check(`mfa.${persona}.enroll-missing-code`, r.status === 200 && p.kind === "totp-setup" && !b.has("bee_session"), `empty code: HTTP ${r.status}, setup page again ("${totp.errorText(r.body)}"), no session`);
  r = await b.req(p.action, post({ totp: totp.wrongCode(u), totpSecret: p.secret, userLabel: "local-check" }));
  p = totp.page(r.body);
  check(`mfa.${persona}.enroll-wrong-code`, r.status === 200 && p.kind === "totp-setup" && !b.has("bee_session"), `wrong code: HTTP ${r.status}, setup page again ("${totp.errorText(r.body)}"), no session`);
  if (p.secret !== s.page.secret) totp.save(u, { secret: p.secret, enrolledAt: new Date().toISOString(), lastStep: -1 });
  /* Keycloak checks the setup code as a required action, so this first ID token carries
     amr ["pwd"] only; the portal refuses it and the user signs in again with a code. */
  let done = await finishAtPortal(b, await b.req(p.action, post({ totp: await totp.nextCode(u), totpSecret: p.secret, userLabel: "local-check" })));
  await totp.recordCredential(u);
  check(`mfa.${persona}.enrolled`, errorOf(done.final) === "mfa_required" && !b.has("bee_session") && (await totp.otpCredentials(u)).length === 1 && (await kcSessions(u)) === 0,
    `correct setup code: 1 OTP credential stored; that login's ID token lacks "otp" in amr, so callback -> error=${errorOf(done.final)}, no portal session, Keycloak session ended`);
  s = await startAndPassword(b, u);
  done = s.page?.kind === "otp" ? await finishAtPortal(b, await b.req(s.page.action, post({ otp: await totp.nextCode(u), login: "Sign In" }))) : {};
  let view = await sessionOf(b);
  const me = await b.req(`${WEB}/api/runtime/me`);
  check(`mfa.${persona}.first-otp-sign-in`, s.page?.kind === "otp" && done.final === `${WEB}/app` && view?.authenticated && JSON.stringify(view.authMethods) === '["pwd","otp"]' && me.status === 200 && me.json?.organisations?.map((o) => o.code).join() === org,
    `sign in again: password, OTP challenge (not setup), code -> /app; session authMethods ${JSON.stringify(view?.authMethods)}; Spring /api/me ${me.status} ${me.json?.organisations?.map((o) => o.code).join()}`);

  /* logout, then a fresh challenge (not enrollment) */
  r = await logout(b);
  check(`mfa.${persona}.logout`, r.json?.signedOut && r.json?.keycloakSessionEnded && !b.has("bee_session") && (await kcSessions(u)) === 0, `portal session and this Keycloak session ended; Keycloak sessions for ${u}: ${await kcSessions(u)}`);
  s = await startAndPassword(b, u);
  check(`mfa.${persona}.fresh-challenge`, !s.sso && s.page?.kind === "otp" && !b.has("bee_session"), `next login: login form, password, then the OTP challenge (${s.page?.kind}); no silent SSO, no session`);
  r = await b.req(s.page.action, post({ otp: "", login: "Sign In" }));
  p = totp.page(r.body);
  check(`mfa.${persona}.missing-otp`, r.status === 200 && p.kind === "otp" && !b.has("bee_session"), `empty code: HTTP ${r.status}, challenge again ("${totp.errorText(r.body)}"), no session`);
  r = await b.req(p.action, post({ otp: totp.wrongCode(u), login: "Sign In" }));
  p = totp.page(r.body);
  check(`mfa.${persona}.wrong-otp`, r.status === 200 && p.kind === "otp" && !b.has("bee_session"), `wrong code: HTTP ${r.status}, challenge again ("${totp.errorText(r.body)}"), no session`);
  const good = await totp.nextCode(u);
  const goodStep = totp.load(u).lastStep;
  done = await finishAtPortal(b, await b.req(p.action, post({ otp: good, login: "Sign In" })));
  view = await sessionOf(b);
  check(`mfa.${persona}.correct-otp`, done.final === `${WEB}/app` && JSON.stringify(view?.authMethods) === '["pwd","otp"]', `correct code after two failures -> /app; authMethods ${JSON.stringify(view?.authMethods)}`);

  /* the same code cannot be used again while it is still inside the time window */
  await logout(b);
  s = await startAndPassword(b, u);
  const inWindow = totp.currentStep() <= goodStep + 1;
  r = await b.req(s.page.action, post({ otp: good, login: "Sign In" }));
  p = totp.page(r.body);
  check(`mfa.${persona}.replayed-otp`, inWindow && r.status === 200 && p.kind === "otp" && !b.has("bee_session"), `code from the previous login re-sent while still in its time window (${inWindow}): HTTP ${r.status}, challenge again, no session`);
  done = await finishAtPortal(b, await b.req(p.action, post({ otp: await totp.nextCode(u), login: "Sign In" })));
  check(`mfa.${persona}.after-replay`, done.final === `${WEB}/app`, `fresh code then accepted -> ${done.final}`);
  await logout(b);
}

async function main() {
  await enrollAndChallenge("nova.applicant", "NOVA");
  await enrollAndChallenge("pixel.applicant", "PIXEL");

  /* password grant (local check client): OTP required, single use */
  {
    const u = M("nova.applicant");
    const none = await totp.passwordGrant(u, { otp: null });
    const wrong = await totp.passwordGrant(u, { otp: totp.wrongCode(u) });
    const code = await totp.nextCode(u);
    const ok = await totp.passwordGrant(u, { otp: code });
    const replay = await totp.passwordGrant(u, { otp: code });
    check("mfa.password-grant", none.status === 400 && wrong.status === 400 && ok.status === 200 && JSON.stringify(amrOf(ok.json.access_token)) === '["pwd","otp"]' && replay.status === 400,
      `bee-local-check password grant: no code ${none.status} ${none.json.error}; wrong ${wrong.status}; correct ${ok.status} amr=${JSON.stringify(ok.json.access_token ? amrOf(ok.json.access_token) : null)}; same code again ${replay.status}`);
    await totp.logoutUser(u);
  }

  /* a rejected callback leaves the MFA'd Keycloak session; retry and logout are safe */
  {
    const u = M("nova.applicant");
    const b = new Browser();
    const s = await startAndPassword(b, u);
    const r = await b.settle(await b.req(s.page.action, post({ otp: await totp.nextCode(u), login: "Sign In" })));
    const cb = new URL(r.location);
    cb.searchParams.set("state", "tampered");
    const bad = await b.req(cb.toString());
    const left = await kcSessions(u);
    check("mfa.rejected-callback-leaves-kc", errorOf(bad.location) === "invalid_state" && !b.has("bee_session") && left === 1, `state tampered after password+OTP: -> error=${errorOf(bad.location)}, no portal session; Keycloak session left in this browser: ${left}`);
    const retry = await startAndPassword(b, u);
    const done = retry.sso ? await finishAtPortal(b, { status: 302, location: retry.sso }) : {};
    const view = await sessionOf(b);
    check("mfa.rejected-callback-retry", !!retry.sso && done.final === `${WEB}/app` && JSON.stringify(view?.authMethods) === '["pwd","otp"]',
      `retry in the same browser reuses that Keycloak session (no new password or code): -> ${done.final}; ID token still records ${JSON.stringify(view?.authMethods)}`);
    const out = await logout(b);
    const again = await startAndPassword(b, u);
    check("mfa.rejected-callback-logout", out.json?.keycloakSessionEnded && (await kcSessions(u)) === 0 && again.page?.kind === "otp", `logout ends it (Keycloak sessions ${await kcSessions(u)}); next login asks for password and OTP again (${again.page?.kind})`);
  }

  /* a Spring-denied identity: OTP passes, Spring refuses, nothing is left to reuse */
  {
    const u = M("no.account");
    await totp.ensureEnrolled(u);
    const b = new Browser();
    const s = await startAndPassword(b, u);
    const done = await finishAtPortal(b, await b.req(s.page.action, post({ otp: await totp.nextCode(u), login: "Sign In" })));
    const left = await kcSessions(u);
    const again = await startAndPassword(b, u);
    check("mfa.spring-denied-retry", errorOf(done.final) === "no_active_account" && !b.has("bee_session") && left === 0 && !again.sso && again.page?.kind === "otp",
      `password+OTP, then Spring refuses: -> error=${errorOf(done.final)}; Keycloak session ended (${left}); retry asks for password and OTP again (${again.page?.kind})`);
  }

}

module.exports = { Browser, post, startAndPassword, finishAtPortal, sessionOf, logout, kcSessions, errorOf, amrOf, check, counts: () => ({ pass, fail }) };

if (require.main === module) (async () => {
  await realmChecks();
  if (!REALM_ONLY) await ids.withIdentities("mfa", main, { personas: ["nova.applicant", "pixel.applicant", "no.account"] });
})()
  .catch((e) => check("mfa.run", false, `aborted: ${e.message}`))
  .then(() => {
    console.log(`mfa checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
