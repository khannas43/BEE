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
const { admin, adminToken } = require("../local/totp.cjs");
const { USERS, DEV_PASSWORD } = require("../../local/generate-fixtures.cjs");

const DEMO_PASSWORD = process.env.BEE_DEMO_PASSWORD || "demo123";
const FLOW = "bee demo direct grant";
const CLIENT = "bee-web";
const KC = `http://127.0.0.1:${process.env.BEE_KC_PORT || "8180"}`;
const REALM = process.env.BEE_REALM || "bee-local";

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
  const execs = await admin(`/authentication/flows/${encodeURIComponent(FLOW)}/executions`);
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
  for (const u of USERS) {
    const found = (await admin(`/users?username=${encodeURIComponent(u.username)}&exact=true`))[0];
    if (!found) { console.log(`skip ${u.username} (not in Keycloak)`); continue; }
    await raw("PUT", `/users/${found.id}`, { ...found, enabled: true, emailVerified: true, requiredActions: [], firstName: found.firstName || u.first, lastName: found.lastName || u.last, email: found.email || `${u.username}@example.invalid` });
    await raw("PUT", `/users/${found.id}/reset-password`, { type: "password", value: DEMO_PASSWORD, temporary: false });
    await raw("DELETE", `/attack-detection/brute-force/users/${found.id}`);
    done++;
  }
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
  for (const u of USERS) {
    const found = (await admin(`/users?username=${encodeURIComponent(u.username)}&exact=true`))[0];
    if (!found) continue;
    await raw("PUT", `/users/${found.id}/reset-password`, { type: "password", value: DEV_PASSWORD, temporary: false });
    // apply cleared the pending authenticator setup; give it back to anyone who has not enrolled (as the seed had it)
    const creds = await admin(`/users/${found.id}/credentials`);
    const enrolled = Array.isArray(creds) && creds.some((c) => c.type === "otp");
    const fresh = (await admin(`/users/${found.id}`)) || found;
    await raw("PUT", `/users/${found.id}`, { ...fresh, requiredActions: enrolled ? [] : ["CONFIGURE_TOTP"] });
    done++;
  }
  console.log(`demo sign-in removed: ${done} people back on the seeded password; flow and client binding deleted`);
}

const cmd = process.argv[2];
(cmd === "apply" ? apply() : cmd === "undo" ? undo() : Promise.reject(new Error("usage: login-setup.cjs apply|undo"))).catch((e) => { console.error(e.message); process.exit(1); });
