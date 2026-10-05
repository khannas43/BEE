/**
 * Proves local:check leaves a person's own authenticator alone. Stands in for a person
 * enrolling Nova and PixelCert on their phone: the "phone" is a separate store,
 * .local/run/phone-authenticator/ (git-ignored), which the checks' store never sees.
 *
 *   node scripts/local/manual-authenticator-proof.cjs enroll   before local:check
 *   node scripts/local/manual-authenticator-proof.cjs verify   after local:check
 *
 * enroll: enrolls each user through Keycloak's real setup page if it has no OTP
 * credential (never replaces one), then signs Nova in to the portal and keeps that
 * session. verify: the kept session still works (its tokens refresh through the same
 * Keycloak session); both users sign in fresh with password and a phone code; the
 * checks' own helper reports their credentials as unusable and does not replace them.
 */
const fs = require("fs");
const path = require("path");
const PHONE = path.join(__dirname, "../../.local/run/phone-authenticator");
process.env.BEE_TOTP_DIR = PHONE;
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const { Browser, post, startAndPassword, finishAtPortal, sessionOf, logout, check, counts } = require("./mfa-check.cjs");

const WEB = `http://127.0.0.1:${process.env.BEE_WEB_PORT || "3100"}`;
const USERS = [["nova.applicant", "NOVA"], ["pixel.applicant", "PIXEL"]];
const KEPT = path.join(PHONE, "nova-portal-session");

async function signIn(u) {
  const b = new Browser();
  const s = await startAndPassword(b, u);
  const done = s.page?.kind === "otp" ? await finishAtPortal(b, await b.req(s.page.action, post({ otp: await totp.nextCode(u), login: "Sign In" }))) : {};
  return { b, s, done };
}

async function enroll() {
  for (const [u] of USERS) {
    const enrolled = await totp.ensureEnrolled(u, { allowProtected: true });
    const creds = await totp.otpCredentials(u);
    check(`manual.${u}.enrolled`, creds.length === 1 && totp.load(u)?.credentialId === creds[0].id, `${enrolled ? "enrolled now" : "already enrolled"} on the phone store; OTP credential ${creds[0]?.id}`);
  }
  const { b, done } = await signIn("nova.applicant");
  const view = await sessionOf(b);
  fs.writeFileSync(KEPT, b.c.get("127.0.0.1|bee_session") || "", { mode: 0o600 });
  check("manual.nova.session-kept", done.final === `${WEB}/app` && JSON.stringify(view?.authMethods) === '["pwd","otp"]', `Nova signed in with a phone code -> ${done.final}; portal session kept for verify`);
}

async function verify() {
  const kept = new Browser();
  kept.c.set("127.0.0.1|bee_session", fs.readFileSync(KEPT, "utf8"));
  const before = await sessionOf(kept);
  const me = await kept.req(`${WEB}/api/runtime/me`);
  const after = await sessionOf(kept);
  check("manual.nova.kept-session-works", me.status === 200 && me.json?.organisations?.[0]?.code === "NOVA",
    `session from before local:check: /api/runtime/me ${me.status} ${me.json?.organisations?.[0]?.code}; refreshCount ${before?.refreshCount} -> ${after?.refreshCount} (refresh needs the same Keycloak session)`);
  await logout(kept);
  fs.rmSync(KEPT, { force: true });

  for (const [u, org] of USERS) {
    const { b, s, done } = await signIn(u);
    const view = await sessionOf(b);
    const r = await b.req(`${WEB}/api/runtime/me`);
    check(`manual.${u}.phone-code-works`, s.page?.kind === "otp" && done.final === `${WEB}/app` && JSON.stringify(view?.authMethods) === '["pwd","otp"]' && r.status === 200 && r.json?.organisations?.[0]?.code === org,
      `fresh sign-in: password, OTP challenge, phone code -> ${done.final}; Spring ${r.status} ${r.json?.organisations?.[0]?.code}`);
    await logout(b);
    const ids0 = (await totp.otpCredentials(u)).map((c) => c.id).join();
    let out = "", code = 0;
    try { out = execFileSync("node", [path.join(__dirname, "totp.cjs"), "token", u], { env: { ...process.env, BEE_TOTP_DIR: "" }, stdio: ["ignore", "pipe", "pipe"] }).toString(); }
    catch (e) { code = e.status; out = String(e.stderr); }
    const ids1 = (await totp.otpCredentials(u)).map((c) => c.id).join();
    check(`manual.${u}.helper-refuses`, code !== 0 && /not replaced/.test(out) && ids0 === ids1,
      `checks' helper without the phone secret: exit ${code}, "${out.trim().slice(0, 90)}..."; credential unchanged (${ids1})`);
  }
}

const mode = process.argv[2];
(mode === "enroll" ? enroll() : mode === "verify" ? verify() : Promise.reject(new Error("usage: manual-authenticator-proof.cjs enroll|verify")))
  .catch((e) => check("manual.run", false, `aborted: ${e.message}`))
  .then(() => {
    const { pass, fail } = counts();
    console.log(`manual-authenticator checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
