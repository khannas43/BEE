/* eslint-disable */
/**
 * WP02.4 complete denial evidence (acceptance cases N1 to N10 and A7): every persona that is not entitled to a step is denied at every
 * step route on every seeded application, nothing changes, and the history of each application is identical afterwards.
 *
 * The matrix is every persona x every command route x every seeded application, minus the few combinations where the persona is the
 * entitled actor at that stage (those are the happy paths proved by the activity checks). Each denied call must answer 403 or 404 (a 401 would mean an expired token, not a denial) and
 * no application, submission event or transition event may differ afterwards (A7). The cases that need a live multi-stage application
 * (N6 superseded rating, N8 the same person at two stages) are proved by the activity checks named in docs/wp02/WP02.4_DENIAL_EVIDENCE.md.
 *
 *   node scripts/local/denial-suite-check.cjs
 *
 * Calls Spring directly with disposable twins' tokens (scripts/local/test-identities.cjs). Appends JSON lines to $AUTH_RESULTS when set.
 */
const fs = require("fs");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { APPLICATIONS, app } = require("../../local/generate-fixtures.cjs");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");

const env = (k, d) => process.env[k] || d;
const API = `http://127.0.0.1:${env("BEE_API_PORT", "8090")}`;
let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(44)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}
const sqlMaint = (q) => execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", env("BEE_MAINT_DB_USER", "bee_local_maint"), "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
const sql = (q) => execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${env("BEE_APP_DB_PASSWORD", "bee-local-app")}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();

const PERSONAS = ["nova.applicant", "pixel.applicant", "bee.finance", "iame.officer", "bee.reviewer", "bee.programme", "bee.director", "bee.secretary", "bee.admin", "bee.helpdesk", "bee.auditor", "sda.officer", "lab.officer"];
const ROUTE_CASES = {
  // route: { method, body, legit(persona, appRef, state) }
  "fee-confirmation": { m: "POST", legit: (p, s) => p === "bee.finance" && s === "fee_due" },
  "iame-recommendation": { m: "POST", legit: (p, s, ref) => p === "iame.officer" && s === "iame_scrutiny" && ref === "LOCAL-MA-0003" },
  "reviewer-forward": { m: "POST", legit: () => false },
  "rating": { m: "POST", legit: () => false },
  "director-recommendation": { m: "POST", legit: () => false },
  "secretary-approval": { m: "POST", legit: () => false },
  "return": { m: "POST", legit: (p, s, ref) => p === "iame.officer" && s === "iame_scrutiny" && ref === "LOCAL-MA-0003" },
  "reject": { m: "POST", legit: (p, s, ref) => p === "iame.officer" && s === "iame_scrutiny" && ref === "LOCAL-MA-0003" },
  "resubmit": { m: "POST", body: { version: 0 }, legit: () => false },
  "submit": { m: "POST", body: { version: 0, expectedFee: { amountInr: "1.00", feeRuleKey: "RAC:new_model", feeRuleVersion: 1 } }, legit: (p, s, ref) => p === "nova.applicant" && ref === "LOCAL-MA-0001" },
  "": { m: "PATCH", body: { version: 0, category: "RAC", modelNumber: "DENIAL-PROBE" }, legit: (p, s) => p === "nova.applicant" && s === "draft" },
};

const tokens = {};
async function token(u) {
  if (!(u in tokens)) tokens[u] = await totp.accessToken(ids.name(u));
  return tokens[u];
}
async function call(u, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token(u)}`, "Content-Type": "application/json", ...(method === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID().replace(/-/g, "").slice(0, 24) }) },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
}
const snapshot = () => sql(`SELECT (SELECT coalesce(string_agg(id || ':' || state || ':' || version, ',' ORDER BY id), '') FROM app.model_application) || '|' ||
  (SELECT count(*) FROM app.model_application_transition_event) || '|' || (SELECT count(*) FROM app.model_application_submission_event) || '|' ||
  (SELECT count(*) FROM app.model_application_fee_snapshot)`);
const OWNER = { NOVA: "nova.applicant", PIXEL: "pixel.applicant" };

async function main() {
  const apps = APPLICATIONS.map((a) => ({ ref: a.reference, id: app(a.n), state: a.state, org: a.org }));
  const history = async () => {
    const out = {};
    for (const a of apps) out[a.ref] = (await call(OWNER[a.org], "GET", `/api/model-applications/${a.id}/history`)).text;
    return out;
  };
  // A previous run that was killed mid-scenario must not poison this one.
  sql(`UPDATE app.model_application SET state = 'bee_scrutiny' WHERE reference = 'LOCAL-MA-0004' AND state IN ('secretary_approval', 'director_review')`);
  sqlMaint(`DELETE FROM app.model_application_transition_event WHERE action = 'denial_probe'`);
  const before = snapshot();
  const historyBefore = await history();
  check("denial.control-history-readable", apps.every((a) => !historyBefore[a.ref].includes("not_found") && !historyBefore[a.ref].includes("unauthenticated")),
    `the owner reads the history of all ${apps.length} applications (so the ids and the path are right and the A7 comparison is not of four refusals)`);
  // Positive control: the entitled actor reaches the service on the routes where one is seeded (an empty body is refused as invalid, so nothing changes).
  for (const [who, route, ref] of [["bee.finance", "fee-confirmation", "LOCAL-MA-0002"], ["iame.officer", "iame-recommendation", "LOCAL-MA-0003"], ["iame.officer", "return", "LOCAL-MA-0003"], ["iame.officer", "reject", "LOCAL-MA-0003"]]) {
    const a = apps.find((x) => x.ref === ref);
    const c = await call(who, "POST", `/api/model-applications/${a.id}/${route}`, {});
    check(`denial.control-${route}-reaches-the-service`, c.status === 422 || c.status === 409, `the entitled actor on ${ref}: ${c.status} ${c.json?.error ?? ""} (not 403 or 404, so the route and the record are right)`);
  }

  const perRoute = {};
  let denied = 0, total = 0, extra = 0;
  const wrong = [];
  for (const [route, c] of Object.entries(ROUTE_CASES)) {
    for (const k of Object.keys(tokens)) delete tokens[k]; // a fresh token per route: a 300 s token cannot expire mid-matrix
    perRoute[route || "patch"] = { total: 0, denied: 0 };
    for (const a of apps) {
      for (const p of PERSONAS) {
        if (c.legit(p, a.state, a.ref)) continue;
        // a persona acts on its own organisation's record through the applicant routes; the entitled owner is skipped above only where the state allows
        const r = await call(p, c.m, `/api/model-applications/${a.id}${route ? "/" + route : ""}`, c.body);
        total++;
        perRoute[route || "patch"].total++;
        if ([403, 404].includes(r.status)) {
          denied++;
          perRoute[route || "patch"].denied++;
        } else {
          wrong.push(`${p} ${c.m} ${route || "(patch)"} ${a.ref} -> ${r.status} ${r.json?.error ?? ""}`);
        }
      }
    }
  }
  for (const [route, v] of Object.entries(perRoute)) {
    check(`denial.${route}`, v.total === v.denied, `${v.denied} of ${v.total} calls by personas not entitled to this step were denied (403 or 404)`);
  }
  check("denial.matrix", wrong.length === 0, `${denied} of ${total} denied; ${wrong.length === 0 ? "none allowed" : "ALLOWED: " + wrong.slice(0, 5).join("; ")}`);

  /* the named acceptance cases, picked out of the same matrix with their wording */
  const probe = async (u, m, path, body) => { extra++; return call(u, m, path, body); };
  const a2 = apps.find((a) => a.ref === "LOCAL-MA-0002"), a3 = apps.find((a) => a.ref === "LOCAL-MA-0003"), a4 = apps.find((a) => a.ref === "LOCAL-MA-0004"), a1 = apps.find((a) => a.ref === "LOCAL-MA-0001");
  let r = await probe("pixel.applicant", "PATCH", `/api/model-applications/${a1.id}`, ROUTE_CASES[""].body);
  const r2 = await probe("nova.applicant", "PATCH", `/api/model-applications/${a3.id}`, ROUTE_CASES[""].body);
  check("denial.N1-cross-organisation-edit", r.status === 404 && r2.status === 404, `Pixel editing Nova's draft ${r.status}; Nova editing Pixel's application ${r2.status} (not_found, nothing disclosed)`);
  r = await probe("nova.applicant", "POST", `/api/model-applications/${a2.id}/fee-confirmation`, {});
  const rf = await probe("pixel.applicant", "POST", `/api/model-applications/${a2.id}/fee-confirmation`, {});
  check("denial.N3-fee-confirmation-only-finance", r.status === 403 && rf.status === 404, `payer ${r.status} ${r.json?.error}; another organisation ${rf.status}`);
  r = await probe("bee.finance", "POST", `/api/model-applications/${a4.id}/director-recommendation`, {});
  const rg = await probe("bee.finance", "POST", `/api/model-applications/${a4.id}/rating`, {});
  const rh = await probe("bee.finance", "POST", `/api/model-applications/${a4.id}/secretary-approval`, {});
  check("denial.N4-finance-has-no-technical-action", [r, rg, rh].every((x) => [403, 404].includes(x.status)), `Finance: recommendation ${r.status}, rating ${rg.status}, approval ${rh.status}`);
  r = await probe("iame.officer", "POST", `/api/model-applications/${a3.id}/secretary-approval`, {});
  const ri = await probe("iame.officer", "POST", `/api/model-applications/${a4.id}/iame-recommendation`, {});
  check("denial.N5-iame-no-approval-and-only-assigned", [403, 404].includes(r.status) && [403, 404].includes(ri.status), `IAME approving ${r.status}; IAME on an unassigned application ${ri.status}`);
  r = await probe("bee.director", "POST", `/api/model-applications/${a4.id}/director-recommendation`, {});
  const rj = await probe("bee.secretary", "POST", `/api/model-applications/${a4.id}/secretary-approval`, {});
  check("denial.N6-N7-N9-deciding-out-of-order", [403, 404].includes(r.status) && [403, 404].includes(rj.status), `an application at BEE scrutiny with no rating: Director ${r.status}, Secretary ${rj.status}`);
  for (const [name, who] of [["helpdesk", "bee.helpdesk"], ["admin", "bee.admin"], ["auditor", "bee.auditor"]]) {
    const codes = [];
    for (const route of ["fee-confirmation", "iame-recommendation", "reviewer-forward", "rating", "director-recommendation", "secretary-approval", "return", "reject"]) {
      codes.push((await probe(who, "POST", `/api/model-applications/${a2.id}/${route}`, {})).status);
    }
    check(`denial.N10-${name}-has-no-transition`, codes.every((c) => [403, 404].includes(c)), `${name}: ${codes.join(", ")}`);
  }

  /* A7: every denial left the data, the events and the history exactly as they were */
  const after = snapshot();
  const historyAfter = await history();
  check("denial.A7-nothing-changed", before === after, `applications, submission events, transition events and fee snapshots identical after ${total + extra} denied calls`);
  check("denial.A7-history-unchanged", apps.every((a) => historyBefore[a.ref] === historyAfter[a.ref]), `the history of all ${apps.length} applications is byte-identical before and after`);

  /* N8: a person who already acted at another stage of one application is refused at this one, whatever the role. A seeded application is moved
     to the stage and an earlier step by the same twin is written (the local maintenance login removes it again). */
  for (const [who, route, stage, priorFrom, label] of [["bee.secretary", "secretary-approval", "secretary_approval", "director_review", "Secretary"], ["bee.director", "director-recommendation", "director_review", "rating", "Director"]]) {
    const account = ids.accountId(who);
    const started = sql(`SELECT version FROM app.model_application WHERE id = '${a4.id}'`);
    let marker = null;
    try {
      sql(`UPDATE app.model_application SET state = '${stage}' WHERE id = '${a4.id}'`);
      marker = sql(`INSERT INTO app.model_application_transition_event (application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) VALUES ('${a4.id}', 'denial_probe', '${priorFrom}', '${stage}', '${account}', '${who.split(".")[1]}', 99) RETURNING id`).split("\n")[0];
      const same = await call(who, "POST", `/api/model-applications/${a4.id}/${route}`, { version: Number(started), note: "N8 probe" });
      check(`denial.N8-same-person-two-stages-${label.toLowerCase()}`, same.status === 403 && same.json?.error === "segregation_refused", `${label} who already acted at ${priorFrom} on the same application: ${same.status} ${same.json?.error}`);
      sql(`SELECT 1`);
    } finally {
      sql(`UPDATE app.model_application SET state = 'bee_scrutiny' WHERE id = '${a4.id}'`);
      if (marker) sqlMaint(`DELETE FROM app.model_application_transition_event WHERE id = '${marker}'`);
    }
  }
  check("denial.N8-restored", snapshot() === before, "the seeded application and its events are exactly as they were");
}

ids.withIdentities("test", main)
  .catch((e) => check("denial.run", false, String(e.message)))
  .then(() => {
    console.log(`denial checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
