/* eslint-disable */
/**
 * WP02.2 direct API checks: model-application list and read scope, decided by Spring's
 * account, role, membership and assignment rows. Calls Spring directly with Keycloak
 * tokens (password grant through the bee-local-check client, whose organisation claim
 * is wrong on purpose) and flips database rows to prove the database is the authority.
 * Every row it changes is restored in a finally block.
 *
 *   node scripts/local/access-check.cjs
 *
 * Appends JSON lines to $AUTH_RESULTS when set (used by local:check).
 */
const fs = require("fs");
const { execFileSync } = require("child_process");
const { APPLICATIONS, app, usr } = require("../../local/generate-fixtures.cjs");
const totp = require("./totp.cjs");

const env = (k, d) => process.env[k] || d;
const API = `http://127.0.0.1:${env("BEE_API_PORT", "8090")}`;

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(34)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}
function sql(statement) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${env("BEE_APP_DB_PASSWORD", "bee-local-app")}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", statement]).toString().trim();
}

const byRef = Object.fromEntries(APPLICATIONS.map((a) => [a.reference, { ...a, id: app(a.n) }]));
const NOVA_REFS = APPLICATIONS.filter((a) => a.org === "NOVA").map((a) => a.reference);
const PIXEL_REFS = APPLICATIONS.filter((a) => a.org === "PIXEL").map((a) => a.reference);
const idsOf = (refs) => refs.map((r) => byRef[r].id);
const NOT_FOUND = JSON.stringify({ error: "not_found" });

const tokens = {};
async function token(username) {
  if (tokens[username]) return tokens[username];
  return (tokens[username] = await totp.accessToken(username));
}
async function call(username, path, method = "GET") {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${await token(username)}`, "Content-Type": "application/json" }, body: method === "GET" ? undefined : "{}" });
  const body = await r.text();
  let json = null;
  try { json = JSON.parse(body); } catch {}
  return { status: r.status, body, json };
}
const refs = (r) => (r.json?.items || []).map((i) => i.reference).sort();
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const leaks = (body, refsList) => [...idsOf(refsList), ...refsList].filter((x) => body.includes(x));

(async () => {
  const snapshot = () => sql("SELECT string_agg(id || ':' || state || ':' || version, ',' ORDER BY id) FROM app.model_application");
  const before = snapshot();

  /* ---------- the two organisations ---------- */
  let r = await call("nova.applicant", "/api/model-applications");
  check("scope.nova-list", r.status === 200 && same(refs(r), NOVA_REFS) && r.json.items.every((i) => i.organisation === "NOVA" && i.readBasis.join() === "own-org"),
    `HTTP ${r.status} ${refs(r).join(", ")} (Nova's 3, own-org; token claims "PixelCert Agency")`);
  check("scope.nova-list-no-pixel-ids", leaks(r.body, PIXEL_REFS).length === 0 && !r.body.includes("PIXEL"), `PixelCert IDs or references in Nova's list: ${leaks(r.body, PIXEL_REFS).join(", ") || "none"}`);
  r = await call("nova.applicant", "/api/model-applications?organisation=PIXEL&scope=all");
  check("scope.nova-list-params-ignored", r.status === 200 && same(refs(r), NOVA_REFS), `?organisation=PIXEL&scope=all -> ${refs(r).join(", ")}`);

  r = await call("pixel.applicant", "/api/model-applications");
  check("scope.pixel-list", r.status === 200 && same(refs(r), PIXEL_REFS) && r.json.items.every((i) => i.organisation === "PIXEL"), `HTTP ${r.status} ${refs(r).join(", ")} (PixelCert's 1)`);
  check("scope.pixel-list-no-nova-ids", leaks(r.body, NOVA_REFS).length === 0 && !r.body.includes("NOVA"), `Nova IDs or references in PixelCert's list: ${leaks(r.body, NOVA_REFS).join(", ") || "none"}`);

  r = await call("nova.applicant", `/api/model-applications/${byRef["LOCAL-MA-0002"].id}`);
  check("scope.nova-read-own", r.status === 200 && r.json.reference === "LOCAL-MA-0002" && r.json.state === "fee_due", `HTTP ${r.status} ${r.json?.reference} ${r.json?.state}`);
  r = await call("pixel.applicant", `/api/model-applications/${byRef["LOCAL-MA-0003"].id}`);
  check("scope.pixel-read-own", r.status === 200 && r.json.reference === "LOCAL-MA-0003", `HTTP ${r.status} ${r.json?.reference}`);

  const crossReads = [];
  for (const ref of PIXEL_REFS) crossReads.push(["nova.applicant", ref, await call("nova.applicant", `/api/model-applications/${byRef[ref].id}`)]);
  for (const ref of NOVA_REFS) crossReads.push(["pixel.applicant", ref, await call("pixel.applicant", `/api/model-applications/${byRef[ref].id}`)]);
  check("scope.cross-org-read-denied", crossReads.every(([, , x]) => x.status === 404 && x.body === NOT_FOUND),
    crossReads.map(([u, ref, x]) => `${u.split(".")[0]}->${ref} ${x.status}`).join("; ") + ` (body ${NOT_FOUND}, no data)`);

  const unknown = [];
  for (const p of ["00000000-0000-4000-c000-000000000999", "LOCAL-MA-0003", "not-a-uuid"]) unknown.push([p, await call("nova.applicant", `/api/model-applications/${p}`)]);
  check("scope.unknown-record", unknown.every(([, x]) => x.status === 404 && x.body === NOT_FOUND),
    unknown.map(([p, x]) => `${p} ${x.status}`).join("; ") + " (same body as a denied read)");

  /* ---------- assignment records are the authority for IAME and Reviewer ---------- */
  r = await call("iame.officer", "/api/model-applications");
  check("scope.iame-assigned-only", r.status === 200 && same(refs(r), ["LOCAL-MA-0003"]) && r.json.items[0].readBasis.join() === "assigned", `HTTP ${r.status} ${refs(r).join(", ")} (one active assignment)`);
  try {
    sql(`UPDATE app.model_application SET state = 'bee_scrutiny' WHERE id = '${byRef["LOCAL-MA-0003"].id}'`);
    const staleList = await call("iame.officer", "/api/model-applications");
    const staleRead = await call("iame.officer", `/api/model-applications/${byRef["LOCAL-MA-0003"].id}`);
    check("scope.iame-old-stage-assignment", staleList.status === 200 && staleList.json?.count === 0 && staleRead.status === 404 && staleRead.body === NOT_FOUND,
      `active iame_scrutiny assignment after handoff to bee_scrutiny: list ${staleList.json?.count}, read HTTP ${staleRead.status}`);
  } finally {
    sql(`UPDATE app.model_application SET state = 'iame_scrutiny' WHERE id = '${byRef["LOCAL-MA-0003"].id}'`);
  }
  r = await call("iame.officer", `/api/model-applications/${byRef["LOCAL-MA-0002"].id}`);
  check("scope.iame-unassigned-read", r.status === 404 && r.body === NOT_FOUND, `LOCAL-MA-0002 (not assigned): HTTP ${r.status}`);
  r = await call("bee.reviewer", "/api/model-applications");
  const rr = await call("bee.reviewer", `/api/model-applications/${byRef["LOCAL-MA-0004"].id}`);
  check("scope.unassigned-reviewer", r.status === 200 && r.json.count === 0 && rr.status === 404 && rr.body === NOT_FOUND,
    `list HTTP ${r.status} count ${r.json?.count}; LOCAL-MA-0004 at bee_scrutiny with only an inactive assignment: HTTP ${rr.status}`);
  try {
    sql(`UPDATE app.assignment SET active = true WHERE user_id = '${usr(5)}' AND subject_id = '${byRef["LOCAL-MA-0004"].id}'`);
    r = await call("bee.reviewer", "/api/model-applications");
    check("scope.reviewer-assignment-activated", r.status === 200 && same(refs(r), ["LOCAL-MA-0004"]), `assignment activated in the DB: ${refs(r).join(", ")}`);
  } finally {
    sql(`UPDATE app.assignment SET active = false WHERE user_id = '${usr(5)}' AND subject_id = '${byRef["LOCAL-MA-0004"].id}'`);
  }
  try {
    sql(`UPDATE app.assignment SET active = false WHERE user_id = '${usr(4)}'`);
    r = await call("iame.officer", "/api/model-applications");
    const x = await call("iame.officer", `/api/model-applications/${byRef["LOCAL-MA-0003"].id}`);
    check("scope.iame-assignment-inactive", r.status === 200 && r.json.count === 0 && x.status === 404, `assignment deactivated: list count ${r.json?.count}, read HTTP ${x.status}`);
  } finally {
    sql(`UPDATE app.assignment SET active = true WHERE user_id = '${usr(4)}'`);
  }

  /* ---------- internal stage roles, and roles with no reviewed read rule ---------- */
  r = await call("bee.finance", "/api/model-applications");
  const fd = await call("bee.finance", `/api/model-applications/${byRef["LOCAL-MA-0001"].id}`);
  check("scope.finance-fee-stage-only", r.status === 200 && same(refs(r), ["LOCAL-MA-0002"]) && fd.status === 404, `fee_due only: ${refs(r).join(", ")}; draft LOCAL-MA-0001 HTTP ${fd.status}`);
  const stage = [];
  for (const u of ["bee.programme", "bee.director", "bee.secretary"]) stage.push([u, await call(u, "/api/model-applications")]);
  check("scope.stage-roles-empty", stage.every(([, x]) => x.status === 200 && x.json.count === 0), stage.map(([u, x]) => `${u} ${x.status}/${x.json?.count}`).join("; ") + " (no seeded application at their stage)");
  const none = [];
  for (const u of ["bee.admin", "bee.helpdesk", "bee.auditor", "sda.officer", "lab.officer"]) {
    none.push([u, await call(u, "/api/model-applications"), await call(u, `/api/model-applications/${byRef["LOCAL-MA-0002"].id}`)]);
  }
  check("scope.no-read-rule-denied", none.every(([, l, g]) => l.status === 403 && l.json?.error === "no_read_scope" && g.status === 403 && !g.body.includes("LOCAL-MA")),
    none.map(([u, l, g]) => `${u} ${l.status}/${g.status}`).join("; ") + " (no_read_scope; Admin, Helpdesk and partners not widened)");

  /* ---------- Keycloak alone never grants: account, role, membership ---------- */
  for (const [u, want] of [["no.account", "no_active_account"], ["inactive.role", "no_effective_role"], ["role.mismatch", "no_effective_role"]]) {
    const l = await call(u, "/api/model-applications");
    const g = await call(u, `/api/model-applications/${byRef["LOCAL-MA-0002"].id}`);
    check(`scope.deny.${u}`, l.status === 403 && l.json?.error === want && g.status === 403 && g.json?.error === want, `list ${l.status} ${l.json?.error}; read ${g.status} ${g.json?.error}`);
  }
  try {
    sql(`UPDATE app.organisation_membership SET active = false WHERE user_id = '${usr(1)}'`);
    const l = await call("nova.applicant", "/api/model-applications");
    const g = await call("nova.applicant", `/api/model-applications/${byRef["LOCAL-MA-0002"].id}`);
    check("scope.nova-inactive-membership", l.status === 403 && l.json?.error === "no_read_scope" && g.status === 403 && !g.body.includes("LOCAL-MA"), `membership inactive: list ${l.status} ${l.json?.error}; read ${g.status}`);
    sql(`UPDATE app.organisation_membership SET active = true, valid_to = now() - interval '1 day' WHERE user_id = '${usr(1)}'`);
    const e = await call("nova.applicant", "/api/model-applications");
    check("scope.nova-expired-membership", e.status === 403 && e.json?.error === "no_read_scope", `membership valid_to in the past: list ${e.status} ${e.json?.error}`);
  } finally {
    sql(`UPDATE app.organisation_membership SET active = true, valid_to = 'infinity' WHERE user_id = '${usr(1)}'`);
  }
  try {
    sql(`UPDATE app.role_assignment SET active = false WHERE user_id = '${usr(1)}'`);
    const l = await call("nova.applicant", "/api/model-applications");
    check("scope.nova-inactive-role", l.status === 403 && l.json?.error === "no_effective_role", `role inactive, token still says manufacturer: list ${l.status} ${l.json?.error}`);
  } finally {
    sql(`UPDATE app.role_assignment SET active = true WHERE user_id = '${usr(1)}'`);
  }
  try {
    sql(`UPDATE app.role_assignment SET role = 'agency' WHERE user_id = '${usr(1)}'`);
    const l = await call("nova.applicant", "/api/model-applications");
    check("scope.nova-token-db-role-mismatch", l.status === 403 && l.json?.error === "no_effective_role", `DB role agency, token role manufacturer: list ${l.status} ${l.json?.error}`);
  } finally {
    sql(`UPDATE app.role_assignment SET role = 'manufacturer' WHERE user_id = '${usr(1)}'`);
  }
  r = await call("nova.applicant", "/api/model-applications");
  check("scope.nova-restored", r.status === 200 && same(refs(r), NOVA_REFS), `after restoring rows: ${refs(r).join(", ")}`);

  /* ---------- transitions stay denied, even for the step's own actor ---------- */
  const id = byRef["LOCAL-MA-0002"].id, pid = byRef["LOCAL-MA-0003"].id;
  const writes = [
    ["nova.applicant", "POST", "/api/model-applications"],
    ["nova.applicant", "PATCH", `/api/model-applications/${byRef["LOCAL-MA-0001"].id}`],
    ["nova.applicant", "POST", `/api/model-applications/${byRef["LOCAL-MA-0001"].id}/submit`],
    ["bee.finance", "POST", `/api/model-applications/${id}/fee/confirm`],
    ["iame.officer", "POST", `/api/model-applications/${pid}/recommend`],
    ["bee.reviewer", "POST", `/api/model-applications/${byRef["LOCAL-MA-0004"].id}/recommend`],
    ["bee.programme", "POST", `/api/model-applications/${id}/rating`],
    ["bee.director", "POST", `/api/model-applications/${id}/decision`],
    ["bee.secretary", "POST", `/api/model-applications/${id}/decision`],
    ["iame.officer", "POST", `/api/model-applications/${pid}/return`],
    ["iame.officer", "POST", `/api/model-applications/${pid}/reject`],
    ["bee.admin", "POST", `/api/model-applications/${id}/decision`],
    ["nova.applicant", "GET", `/api/model-applications/${id}/history`],
  ];
  const results = [];
  for (const [u, m, p] of writes) results.push([u, m, p, await call(u, p, m)]);
  check("actions.transitions-denied", results.every(([, , , x]) => x.status === 403 && x.json?.error === "denied_by_default"),
    `${results.filter(([, , , x]) => x.status === 403).length}/${results.length} denied_by_default: ` + results.map(([u, m, p, x]) => `${u} ${m} ${p.replace(/\/api\/model-applications\/?/, "/").replace(/00000000-0000-4000-c000-0+/, "#")} ${x.status}`).join("; "));
  const after = snapshot();
  const workflowTables = sql("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('transition', 'fee_confirmation', 'rating_result', 'approval_decision')");
  check("actions.no-state-change", before === after && workflowTables === "0", `model_application id:state:version unchanged (${after.split(",").length} rows); workflow tables present: ${workflowTables}`);
  for (const u of Object.keys(tokens)) await totp.logoutUser(u);

  console.log(`access checks: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  check("access.run", false, `aborted: ${e.message}`);
  console.log(`access checks: ${pass} passed, ${fail} failed`);
  process.exit(1);
});
