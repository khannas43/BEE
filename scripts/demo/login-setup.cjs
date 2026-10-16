#!/usr/bin/env node
/**
 * Demonstration sign-in setup for Keycloak (docs/demo/DEMO_WORK_PLAN.md). Used only on the demonstration machine.
 *
 *   node scripts/demo/login-setup.cjs apply   password demo123 for every seeded person, no authenticator step, and a password-only
 *                                             direct-grant flow bound to the portal client (bee-web) alone
 *   node scripts/demo/login-setup.cjs undo    removes that flow and binding, puts the seeded password back (BEE_DEV_USER_PASSWORD)
 *
 * It does not change the realm's browser or direct-grant flows, the OTP policy or anyone's OTP credential, so the normal sign-in with the
 * authenticator code still works wherever BEE_DEMO_LOGIN is not set. The portal needs BEE_DEMO_LOGIN=1 and the API BEE_MFA_REQUIRED=false.
 */
const fs = require("fs");
const path = require("path");
const { admin, adminToken } = require("../local/totp.cjs");
const { USERS, DEV_PASSWORD } = require("../../local/generate-fixtures.cjs");

const DEMO_PASSWORD = process.env.BEE_DEMO_PASSWORD || "demo123";
const FLOW = "bee demo direct grant";
const CLIENT = "bee-web";
const KC = `http://127.0.0.1:${process.env.BEE_KC_PORT || "8180"}`;
const REALM = process.env.BEE_REALM || "bee-local";
// What apply filled in on a person who had nothing there (name, email), so undo can put it back as it was. Git-ignored run state.
const BACKUP = path.join(__dirname, "../../.local/run/demo-login-filled.json");

async function raw(method, pathname, body) {
  const r = await fetch(`${KC}/admin/realms/${REALM}${pathname}`, {
    method, headers: { Authorization: `Bearer ${await adminToken()}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok && r.status !== 404) throw new Error(`${method} ${pathname} -> HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  return r;
}

async function clientRep() {
  const list = await admin(`/clients?clientId=${CLIENT}`);
  if (!Array.isArray(list) || !list[0]) throw new Error(`client ${CLIENT} not found`);
  return list[0];
}

async function ensureFlow() {
  const flows = await admin("/authentication/flows");
  let flow = flows.find((f) => f.alias === FLOW);
  if (!flow) {
    await raw("POST", "/authentication/flows", { alias: FLOW, description: "Demonstration only: username and password, no authenticator code.", providerId: "basic-flow", topLevel: true, builtIn: false });
    flow = (await admin("/authentication/flows")).find((f) => f.alias === FLOW);
    for (const provider of ["direct-grant-validate-username", "direct-grant-validate-password"]) {
      await raw("POST", `/authentication/flows/${encodeURIComponent(FLOW)}/executions/execution`, { provider });
    }
  }
  // A run that stopped after creating the flow leaves it empty: add whichever of the two steps is missing, so a rerun repairs it.
  let execs = await admin(`/authentication/flows/${encodeURIComponent(FLOW)}/executions`);
  for (const provider of ["direct-grant-validate-username", "direct-grant-validate-password"]) {
    if (!execs.some((e) => e.providerId === provider)) await raw("POST", `/authentication/flows/${encodeURIComponent(FLOW)}/executions/execution`, { provider });
  }
  execs = await admin(`/authentication/flows/${encodeURIComponent(FLOW)}/executions`);
  for (const e of execs) if (e.requirement !== "REQUIRED") await raw("PUT", `/authentication/flows/${encodeURIComponent(FLOW)}/executions`, { ...e, requirement: "REQUIRED" });
  return flow;
}

async function apply() {
  const flow = await ensureFlow();
  const client = await clientRep();
  await raw("PUT", `/clients/${client.id}`, { ...client, directAccessGrantsEnabled: true, authenticationFlowBindingOverrides: { ...(client.authenticationFlowBindingOverrides || {}), direct_grant: flow.id } });
  const realm = await admin("");
  if (realm.passwordPolicy) await raw("PUT", "", { ...realm, passwordPolicy: "" });
  let done = 0;
  let filled = {};
  try { filled = JSON.parse(fs.readFileSync(BACKUP, "utf8")); } catch { /* first run */ }
  for (const u of USERS) {
    const found = (await admin(`/users?username=${encodeURIComponent(u.username)}&exact=true`))[0];
    if (!found) { console.log(`skip ${u.username} (not in Keycloak)`); continue; }
    const set = { firstName: found.firstName || u.first, lastName: found.lastName || u.last, email: found.email || `${u.username}@example.invalid` };
    // remember only what this run adds to an empty field (a later run keeps the first record)
    const mine = { ...(filled[u.username] || {}) };
    if (!found.firstName && !mine.firstName) mine.firstName = set.firstName;
    if (!found.lastName && !mine.lastName) mine.lastName = set.lastName;
    if (!found.email && !mine.email) mine.email = set.email;
    if (Object.keys(mine).length) filled[u.username] = mine;
    await raw("PUT", `/users/${found.id}`, { ...found, enabled: true, emailVerified: true, requiredActions: [], ...set });
    await raw("PUT", `/users/${found.id}/reset-password`, { type: "password", value: DEMO_PASSWORD, temporary: false });
    await raw("DELETE", `/attack-detection/brute-force/users/${found.id}`);
    done++;
  }
  fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
  fs.writeFileSync(BACKUP, JSON.stringify(filled, null, 2));
  console.log(`demo sign-in ready: ${done} people, password ${DEMO_PASSWORD}; flow "${FLOW}" bound to ${CLIENT} only; start the portal with BEE_DEMO_LOGIN=1 and the API with BEE_MFA_REQUIRED=false`);
}

async function undo() {
  const client = await clientRep();
  // Keycloak keeps a binding unless it is overwritten with an empty value; an absent key is ignored.
  const overrides = { ...(client.authenticationFlowBindingOverrides || {}), direct_grant: "" };
  await raw("PUT", `/clients/${client.id}`, { ...client, directAccessGrantsEnabled: false, authenticationFlowBindingOverrides: overrides });
  const flow = (await admin("/authentication/flows")).find((f) => f.alias === FLOW);
  if (flow) await raw("DELETE", `/authentication/flows/${flow.id}`);
  let done = 0;
  let filled = {};
  try { filled = JSON.parse(fs.readFileSync(BACKUP, "utf8")); } catch { /* nothing was recorded */ }
  for (const u of USERS) {
    const found = (await admin(`/users?username=${encodeURIComponent(u.username)}&exact=true`))[0];
    if (!found) continue;
    await raw("PUT", `/users/${found.id}/reset-password`, { type: "password", value: DEV_PASSWORD, temporary: false });
    // apply cleared the pending authenticator setup; give it back to anyone who has not enrolled (as the seed had it)
    const creds = await admin(`/users/${found.id}/credentials`);
    const enrolled = Array.isArray(creds) && creds.some((c) => c.type === "otp");
    const fresh = (await admin(`/users/${found.id}`)) || found;
    // names and email that apply added to empty fields go back to empty, unless someone has changed them since
    const mine = filled[u.username] || {};
    const back = {};
    for (const k of ["firstName", "lastName", "email"]) if (mine[k] !== undefined && fresh[k] === mine[k]) back[k] = "";
    await raw("PUT", `/users/${found.id}`, { ...fresh, ...back, requiredActions: enrolled ? [] : ["CONFIGURE_TOTP"] });
    done++;
  }
  try { fs.rmSync(BACKUP); } catch { /* none */ }
  console.log(`demo sign-in removed: ${done} people back on the seeded password; flow and client binding deleted`);
}

const cmd = process.argv[2];
(cmd === "apply" ? apply() : cmd === "undo" ? undo() : Promise.reject(new Error("usage: login-setup.cjs apply|undo"))).catch((e) => { console.error(e.message); process.exit(1); });
