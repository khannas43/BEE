/**
 * WP02.3 defence-in-depth check, NOT part of local:check: for a few seconds it rebinds
 * the whole bee-local realm to Keycloak's built-in conditional flows, under which a user
 * without an OTP credential signs in with a password only. Proves the portal callback
 * and Spring still refuse such a login, then restores the bindings. Run it only when no
 * one else is signing in to the local realm.
 *
 *   npm run local:mfa:misbind
 *
 * Runs as a disposable twin `misbind.pixel.applicant` with no OTP and no pending
 * enrollment, removed afterwards. Records the seeded users' OTP credentials, sessions
 * and the realm flows first and fails if they differ afterwards.
 */
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const protectedState = require("./protected-state.cjs");
const { Browser, startAndPassword, finishAtPortal, kcSessions, errorOf, amrOf, check, counts } = require("./mfa-check.cjs");

const API = `http://127.0.0.1:${process.env.BEE_API_PORT || "8090"}`;
const BOUND = { browserFlow: "bee browser with otp", directGrantFlow: "bee direct grant with otp" };
const bind = (flows) => totp.admin("", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(flows) });

async function main() {
  const u = ids.name("pixel.applicant", "misbind");
  try {
    await bind({ browserFlow: "browser", directGrantFlow: "direct grant" });
    const b = new Browser();
    const s = await startAndPassword(b, u);
    const done = s.response?.status === 302 ? await finishAtPortal(b, s.response) : {};
    const left = await kcSessions(u);
    check("misbind.portal-refuses-password-only", errorOf(done.final) === "mfa_required" && !b.has("bee_session") && left === 0,
      `realm bound to the conditional flow, user without OTP: Keycloak issued a password-only login; callback -> error=${errorOf(done.final)}, no session, Keycloak session ended (${left})`);
    const g = await totp.passwordGrant(u, { otp: null });
    const me = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${g.json.access_token}` } });
    const list = await fetch(`${API}/api/model-applications`, { headers: { Authorization: `Bearer ${g.json.access_token}` } });
    const mj = await me.json(), lj = await list.json();
    check("misbind.spring-refuses-password-only", g.status === 200 && !(amrOf(g.json.access_token) || []).includes("otp") && me.status === 403 && mj.error === "mfa_required" && list.status === 403 && lj.error === "mfa_required",
      `password-only token (amr ${JSON.stringify(g.json.access_token ? amrOf(g.json.access_token) : null)}): /api/me ${me.status} ${mj.error}; /api/model-applications ${list.status} ${lj.error}`);
  } finally {
    await bind(BOUND);
    await totp.logoutUser(u);
  }
  const restored = await totp.admin("");
  const grant = await totp.passwordGrant(u, { otp: null });
  const b = new Browser();
  const s = await startAndPassword(b, u);
  check("misbind.realm-restored", restored.browserFlow === BOUND.browserFlow && restored.directGrantFlow === BOUND.directGrantFlow && !grant.json.access_token && grant.status >= 400 && s.page?.kind === "totp-setup" && !b.has("bee_session"),
    `bindings restored; the same user's password-only grant gets no token (Keycloak HTTP ${grant.status} ${grant.json.error}); browser sign-in is sent to OTP setup (${s.page?.kind}), no session`);
}

(async () => {
  const before = await protectedState.snapshot();
  try {
    await ids.withIdentities("misbind", main, { personas: ["pixel.applicant"], requiredActions: [] });
  } finally {
    const cur = await totp.admin("");
    if (cur.browserFlow !== BOUND.browserFlow || cur.directGrantFlow !== BOUND.directGrantFlow) await bind(BOUND);
  }
  await protectedState.compare(before, check);
})()
  .catch((e) => check("misbind.run", false, `aborted: ${e.message}`))
  .then(() => {
    const { pass, fail } = counts();
    console.log(`misbind checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
