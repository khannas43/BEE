/* eslint-disable */
/**
 * WP02.4 Keycloak brute-force detection: repeated wrong passwords lock the account for a while, even against the correct password and a
 * valid one-time code; an administrator can clear the lock; other accounts are unaffected. Runs as a disposable twin
 * (scripts/local/test-identities.cjs), never a seeded user. Provisional local values (local/generate-fixtures.cjs BRUTE_FORCE), not a BEE rule.
 *
 *   node scripts/local/bruteforce-check.cjs
 *
 * Appends JSON lines to $AUTH_RESULTS when set.
 */
const fs = require("fs");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { BRUTE_FORCE } = require("../../local/generate-fixtures.cjs");

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(40)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}
const status = async (id) => totp.admin(`/attack-detection/brute-force/users/${id}`);
const clear = async (id) => {
  const token = await totp.adminToken();
  const KC = `http://127.0.0.1:${process.env.BEE_KC_PORT || "8180"}`;
  await fetch(`${KC}/admin/realms/${process.env.BEE_REALM || "bee-local"}/attack-detection/brute-force/users/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
};

async function main() {
  const realm = await totp.admin("");
  check("bruteforce.realm-policy", realm.bruteForceProtected === true && realm.permanentLockout === false && realm.failureFactor === BRUTE_FORCE.failureFactor && realm.waitIncrementSeconds > 0,
    `bruteForceProtected=${realm.bruteForceProtected}, permanentLockout=${realm.permanentLockout}, failureFactor=${realm.failureFactor}, first wait ${realm.waitIncrementSeconds}s, longest ${realm.maxFailureWaitSeconds}s, failures counted within ${realm.maxDeltaTimeSeconds}s`);

  const u = ids.name("nova.applicant");
  const other = ids.name("pixel.applicant");
  await totp.ensureEnrolled(u);
  const id = await totp.userId(u);
  const otherId = await totp.userId(other);
  try {
    await clear(id);
    const before = await status(id);
    check("bruteforce.starts-clean", before.disabled === false && !before.numFailures, `failures ${before.numFailures ?? 0}, disabled ${before.disabled}`);

    const n = BRUTE_FORCE.failureFactor;
    let last;
    for (let i = 0; i < n; i++) last = await totp.passwordGrant(u, { password: "wrong-password-" + i, otp: null });
    check("bruteforce.wrong-passwords-refused", last.status === 400 || last.status === 401, `${n} wrong passwords: last answer ${last.status} ${last.json?.error}`);
    const locked = await status(id);
    check("bruteforce.account-locked", locked.disabled === true && locked.numFailures >= n, `after ${n} failures: disabled=${locked.disabled}, failures=${locked.numFailures}`);

    const refused = await totp.passwordGrant(u, {});
    check("bruteforce.correct-credentials-refused-while-locked", refused.status !== 200 && !refused.json?.access_token, `correct password and a valid code while locked: ${refused.status} ${refused.json?.error}`);
    const side = await status(otherId);
    check("bruteforce.other-accounts-unaffected", side.disabled === false, `another account: disabled=${side.disabled}`);

    await clear(id);
    const cleared = await status(id);
    check("bruteforce.administrator-clears-the-lock", cleared.disabled === false && !cleared.numFailures, `after the administrator clears it: disabled=${cleared.disabled}, failures=${cleared.numFailures ?? 0}`);
    const ok = await totp.passwordGrant(u, {});
    check("bruteforce.sign-in-works-again", ok.status === 200 && !!ok.json?.access_token, `correct password and code: ${ok.status}`);
  } finally {
    await clear(id);
    await totp.logoutUser(u).catch(() => {});
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("bruteforce.run", false, String(e.message)))
  .then(() => {
    console.log(`bruteforce checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
