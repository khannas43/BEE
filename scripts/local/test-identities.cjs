/* eslint-disable */
/**
 * Disposable test identities, so local checks never sign in as, enroll, or log out the
 * 16 seeded users. Each twin copies one seeded persona: in Keycloak a new user
 * `<tag>.<username>` with the same realm role, the shared local password and a pending
 * CONFIGURE_TOTP; in bee_app an account with the same membership, role assignment and
 * model-application assignments (ids in the reserved range ...a000-0000000009xx). Spring
 * therefore applies exactly the persona's database rules to the twin.
 *
 *   node scripts/local/test-identities.cjs setup [tag]      create (after removing leftovers)
 *   node scripts/local/test-identities.cjs teardown [tag]   remove users, rows and local secrets
 *   node scripts/local/test-identities.cjs list             what exists now
 *
 * Tags: test (auth, access, browser and token checks), mfa (mfa-check), misbind
 * (mfa-misbind-check). Twin OTP secrets are created by real enrollment, live in the
 * git-ignored TOTP store, and are deleted with the twin.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const { USERS, ORGS, ASSIGNMENTS, usr, app, DEV_PASSWORD } = require("../../local/generate-fixtures.cjs");

const env = (k, d) => process.env[k] || d;
const KC = `http://127.0.0.1:${env("BEE_KC_PORT", "8180")}`;
const REALM = env("BEE_REALM", "bee-local");
const TAGS = { test: 900, mfa: 940, misbind: 980 };
const RESERVED = /^00000000-0000-4000-a000-0000000009\d\d$/;

const persona = (p) => USERS.find((u) => u.username === p) || (() => { throw new Error(`unknown persona ${p}`); })();
const name = (p, tag = "test") => `${tag}.${p}`;
const accountId = (p, tag = "test") => usr(TAGS[tag] + persona(p).n);
const isTwin = (username) => Object.keys(TAGS).some((t) => username.startsWith(`${t}.`) && USERS.some((u) => `${t}.${u.username}` === username));

function sql(statement) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${env("BEE_APP_DB_PASSWORD", "bee-local-app")}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", statement]).toString().trim();
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function kc(pathname, init = {}) {
  const r = await fetch(`${KC}/admin/realms/${REALM}${pathname}`, { ...init, headers: { Authorization: `Bearer ${await totp.adminToken()}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok && r.status !== 404) throw new Error(`Keycloak ${init.method || "GET"} ${pathname}: HTTP ${r.status} ${await r.text()}`);
  return r;
}

/** Twins of a tag currently in Keycloak: [{ username, id }]. */
async function kcTwins(tag) {
  const users = await (await kc(`/users?search=${encodeURIComponent(`${tag}.`)}&max=200&briefRepresentation=true`)).json();
  return users.filter((u) => u.username.startsWith(`${tag}.`) && isTwin(u.username));
}

async function teardown(tag = "test") {
  for (const u of await kcTwins(tag)) await kc(`/users/${u.id}`, { method: "DELETE" });
  const ids = USERS.map((u) => q(usr(TAGS[tag] + u.n))).join(",");
  sql(`BEGIN; DELETE FROM app.assignment WHERE user_id IN (${ids}); DELETE FROM app.role_assignment WHERE user_id IN (${ids}); DELETE FROM app.organisation_membership WHERE user_id IN (${ids}); DELETE FROM app.user_account WHERE id IN (${ids}); COMMIT;`);
  for (const u of USERS) { try { fs.unlinkSync(path.join(totp.DIR, `${name(u.username, tag)}.json`)); } catch {} }
}

/**
 * Creates twins for `personas` (default: all 16). `requiredActions` defaults to a pending
 * CONFIGURE_TOTP, like a freshly reset seeded user.
 */
async function setup(tag = "test", { personas = USERS.map((u) => u.username), requiredActions = ["CONFIGURE_TOTP"] } = {}) {
  if (!TAGS[tag]) throw new Error(`unknown tag ${tag}`);
  await teardown(tag);
  const roles = new Map();
  const rows = [];
  for (const p of personas) {
    const u = persona(p);
    const username = name(p, tag);
    const r = await kc("/users", { method: "POST", body: JSON.stringify({ username, email: `${username}@bee.local.invalid`, emailVerified: true, firstName: u.first, lastName: `${u.last} Test`, enabled: true, requiredActions, credentials: [{ type: "password", value: DEV_PASSWORD, temporary: false }] }) });
    const kcId = r.headers.get("location").split("/").pop();
    if (!roles.has(u.kc)) roles.set(u.kc, await (await kc(`/roles/${encodeURIComponent(u.kc)}`)).json());
    await kc(`/users/${kcId}/role-mappings/realm`, { method: "POST", body: JSON.stringify([roles.get(u.kc)]) });
    if (u.db) rows.push({ u, id: usr(TAGS[tag] + u.n), kcId, username });
  }
  const S = ["BEGIN;"];
  for (const { u, id, kcId, username } of rows) {
    S.push(`INSERT INTO app.user_account (id, keycloak_subject, username, display_name) VALUES (${q(id)}, ${q(kcId)}, ${q(username)}, ${q(`${u.first} ${u.last} (test)`)});`);
    S.push(`INSERT INTO app.organisation_membership (user_id, organisation_id) VALUES (${q(id)}, ${q(ORGS.find((o) => o.code === u.org).id)});`);
    S.push(`INSERT INTO app.role_assignment (user_id, role, scope, active) VALUES (${q(id)}, ${q(u.db.role)}, ${q(u.db.scope)}, ${u.db.active});`);
    for (const a of ASSIGNMENTS.filter((x) => x.user === u.n)) S.push(`INSERT INTO app.assignment (user_id, subject_type, subject_id, stage, active) VALUES (${q(id)}, 'model_application', ${q(app(a.app))}, ${q(a.stage)}, ${a.active});`);
  }
  S.push("COMMIT;");
  sql(S.join(" "));
  return personas.map((p) => name(p, tag));
}

/** Leftovers of any tag: Keycloak twins and bee_app rows in the reserved id range. */
async function leftovers() {
  const kcLeft = [];
  for (const t of Object.keys(TAGS)) kcLeft.push(...(await kcTwins(t)).map((u) => u.username));
  const dbLeft = Number(sql(`SELECT count(*) FROM app.user_account WHERE id::text LIKE '00000000-0000-4000-a000-0000000009%'`));
  return { keycloak: kcLeft, bee_app: dbLeft };
}

/**
 * Runs `fn` with the tag's twins. Reuses them when local:check already created them
 * (BEE_TEST_IDENTITIES lists the tag); otherwise creates them first and removes them after.
 */
async function withIdentities(tag, fn, opts) {
  const shared = (process.env.BEE_TEST_IDENTITIES || "").split(",").includes(tag);
  if (!shared) await setup(tag, opts);
  try { return await fn(); } finally { if (!shared) await teardown(tag); }
}

module.exports = { setup, teardown, leftovers, withIdentities, name, accountId, isTwin, TAGS, RESERVED };

if (require.main === module) {
  const [cmd, tag = "test"] = process.argv.slice(2);
  (async () => {
    if (cmd === "setup") console.log(`created ${(await setup(tag)).length} '${tag}' identities`);
    else if (cmd === "teardown") { await teardown(tag); console.log(`removed '${tag}' identities`); }
    else if (cmd === "list") console.log(JSON.stringify(await leftovers()));
    else { console.error("usage: test-identities.cjs setup|teardown [tag] | list"); process.exit(2); }
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
