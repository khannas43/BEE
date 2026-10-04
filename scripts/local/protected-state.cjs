/* eslint-disable */
/**
 * Guards the seeded users and the realm around a check run.
 *
 *   node scripts/local/protected-state.cjs snapshot <file>   record the state
 *   node scripts/local/protected-state.cjs compare <file>    fail if it changed
 *
 * Records, for each of the 16 seeded Keycloak users, the OTP credential ids and the
 * active session ids; and the realm's browser/direct-grant bindings, the executions of
 * the bound flows and the OTP policy. compare also fails if any disposable test identity
 * (scripts/local/test-identities.cjs) is left in Keycloak or bee_app. Appends JSON lines
 * to $AUTH_RESULTS when set (used by local:check).
 */
const fs = require("fs");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { USERS } = require("../../local/generate-fixtures.cjs");

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(34)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}

async function snapshot() {
  const realm = await totp.admin("");
  const flow = async (alias) => (await totp.admin(`/authentication/flows/${encodeURIComponent(alias)}/executions`)).map((e) => `${e.level}:${e.providerId || e.displayName}:${e.requirement}`);
  const users = {};
  for (const u of USERS) {
    const id = await totp.userId(u.username);
    const creds = (await totp.admin(`/users/${id}/credentials`)).filter((c) => c.type === "otp").map((c) => c.id).sort();
    const sessions = (await totp.admin(`/users/${id}/sessions`)).map((s) => s.id).sort();
    users[u.username] = { otp: creds, sessions };
  }
  return {
    at: new Date().toISOString(),
    realm: {
      browserFlow: realm.browserFlow, directGrantFlow: realm.directGrantFlow,
      browserExecutions: await flow(realm.browserFlow), directGrantExecutions: await flow(realm.directGrantFlow),
      otpPolicy: [realm.otpPolicyType, realm.otpPolicyAlgorithm, realm.otpPolicyDigits, realm.otpPolicyPeriod, realm.otpPolicyLookAheadWindow, realm.otpPolicyCodeReusable].join("/"),
    },
    users,
  };
}

/** Reports through `report` (default: this module's counter) so callers can fold the results in. */
async function compare(before, report = check) {
  const after = await snapshot();
  const changedOtp = USERS.map((u) => u.username).filter((u) => JSON.stringify(before.users[u]?.otp) !== JSON.stringify(after.users[u].otp));
  const enrolled = USERS.filter((u) => after.users[u.username].otp.length).length;
  report("protected.otp-credentials", changedOtp.length === 0,
    `16 seeded users' OTP credential ids ${changedOtp.length ? "CHANGED for " + changedOtp.map((u) => `${u} ${JSON.stringify(before.users[u]?.otp)} -> ${JSON.stringify(after.users[u].otp)}`).join("; ") : "unchanged"} (${enrolled} enrolled, ${16 - enrolled} not)`);
  const ended = [], started = [];
  for (const u of USERS.map((x) => x.username)) {
    const b = before.users[u]?.sessions || [], a = after.users[u].sessions;
    for (const s of b) if (!a.includes(s)) ended.push(`${u}:${s.slice(0, 8)}`);
    for (const s of a) if (!b.includes(s)) started.push(`${u}:${s.slice(0, 8)}`);
  }
  const held = Object.values(before.users).reduce((n, x) => n + x.sessions.length, 0);
  report("protected.sessions", ended.length === 0 && started.length === 0,
    `seeded users' Keycloak sessions: ${held} before; ended during the run: ${ended.length ? ended.join(", ") : "none"}; started: ${started.length ? started.join(", ") : "none"}`);
  const realmSame = JSON.stringify(before.realm) === JSON.stringify(after.realm);
  report("protected.realm-flows", realmSame,
    `browser="${after.realm.browserFlow}", direct grant="${after.realm.directGrantFlow}", ${after.realm.browserExecutions.length + after.realm.directGrantExecutions.length} executions, OTP ${after.realm.otpPolicy}: ${realmSame ? "unchanged" : "CHANGED from " + JSON.stringify(before.realm)}`);
  const left = await ids.leftovers();
  report("protected.test-identities-removed", left.keycloak.length === 0 && left.bee_app === 0,
    `disposable identities left: Keycloak ${left.keycloak.length ? left.keycloak.join(", ") : "none"}; bee_app accounts ${left.bee_app}`);
}

if (require.main === module) {
  const [cmd, file] = process.argv.slice(2);
  (async () => {
    if (cmd === "snapshot") { fs.writeFileSync(file, JSON.stringify(await snapshot(), null, 2)); console.log(`protected state recorded in ${file}`); }
    else if (cmd === "compare") {
      await compare(JSON.parse(fs.readFileSync(file, "utf8")));
      console.log(`protected checks: ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    } else { console.error("usage: protected-state.cjs snapshot|compare <file>"); process.exit(2); }
  })().catch((e) => {
    check("protected.run", false, `aborted: ${e.message}`);
    console.log(`protected checks: ${pass} passed, ${fail} failed`);
    process.exit(1);
  });
}

module.exports = { snapshot, compare };
