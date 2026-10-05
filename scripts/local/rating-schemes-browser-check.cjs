/* eslint-disable */
/** Rating-scheme administration. Propose a scheme, a DIFFERENT person approves or rejects, withdraw, not in the past, one scheme per start day, the rating step's bands untouched, and the permission following the role it is granted to. Schemes start in the year 2100 so they never apply to a real rating; baseline-preserving for everything a rating uses, run twice. */
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");

const contract = require("./contract-lib.cjs");
const doc = contract.load();

const env = (k, d) => process.env[k] || d;
const key = () => crypto.randomUUID().replace(/-/g, "").slice(0, 24);
let pass = 0, fail = 0;
function check(id, ok, detail) { const r = ok ? "PASS" : "FAIL"; ok ? pass++ : fail++; console.log(`${r.padEnd(4)} ${id.padEnd(52)} ${detail}`); }

function psql(user, pw, q) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${pw}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", user, "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
}
const sqlApp = (q) => psql("bee_app", env("BEE_APP_DB_PASSWORD", "bee-local-app"), q);
const sqlMaint = (q) => psql(env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint"), q);

const PATHS = { read: `${WEB}/api/runtime/rating-schemes`, propose: `${WEB}/api/runtime/rating-schemes/proposals`, decide: (id) => `${WEB}/api/runtime/rating-schemes/proposals/${id}/decision` };
const SCREEN = "/app/administration/rating-formula";

const routeOf = (path) => (path.endsWith("/decision") ? "/api/runtime/rating-schemes/proposals/{id}/decision" : path.endsWith("/proposals") ? "/api/runtime/rating-schemes/proposals" : "/api/runtime/rating-schemes");

/** A request through the browser's session; every answer is checked against the artifact and recorded as live evidence. */
async function api(page, method, path, body, idem) {
  const headers = { "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) };
  const bodySnippet = body == null ? "undefined" : `JSON.stringify(${JSON.stringify(body)})`;
  const r = await page.eval(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "include", cache: "no-store", headers: ${JSON.stringify(headers)}, body: ${bodySnippet} }).then(async (r) => { const hs = {}; r.headers.forEach((v, k) => { hs[k] = v; }); return { status: r.status, replay: r.headers.get("Idempotency-Replayed"), body: await r.json().catch(() => null), headers: hs }; })`);
  const route = routeOf(path);
  const faux = contract.observationFromBrowserFetch(r);
  contract.record({ route, method, status: r.status, code: r.status >= 400 ? (r.body?.error ?? "-") : "-", ok: contract.conforms(doc, route, method, faux).length === 0 });
  return r;
}
async function setInput(page, testId, value, kind = "HTMLInputElement", event = "input") {
  await page.eval(`(() => {
    const el = document.querySelector('[data-testid=${testId}]');
    const s = Object.getOwnPropertyDescriptor(window.${kind}.prototype, 'value').set;
    s.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
    return true;
  })()`);
}
const uiClick = (page, testId) => page.eval(`document.querySelector('[data-testid="${testId}"]').click(); true`);
const present = (page, testId, ms = 20000) => page.waitFor(`!!document.querySelector('[data-testid="${testId}"]')`, ms);
const textOf = (page, testId) => page.eval(`document.querySelector('[data-testid="${testId}"]')?.textContent ?? ""`);
const gone = (page, testId, ms = 20000) => page.waitFor(`!document.querySelector('[data-testid="${testId}"]')`, ms);

async function open(page, route, readyTestId) {
  await page.goto(`${WEB}${route}`);
  return present(page, readyTestId, 30000);
}


/** The runtime menu entries a person sees on a fresh page load (the identity, with its permissions, is read once per load). */
async function menuOf(page) {
  await page.goto(`${WEB}/app`);
  await present(page, "runtime-nav", 30000);
  return page.eval(`[...document.querySelectorAll('[data-testid^="runtime-nav-"]')].map((e) => e.getAttribute("data-testid").replace("runtime-nav-", ""))`);
}

const FAR = "2100-01-01";
const nextDate = () => sqlApp(`SELECT (coalesce(max(effective_from) FILTER (WHERE effective_from >= DATE '${FAR}'), DATE '${FAR}' - 1) + 1)::text FROM app.rating_demo_band WHERE category_code = 'RAC'`);
const addDays = (d, n) => sqlApp(`SELECT (DATE '${d}' + ${n})::text`);
const proposalRow = (id) => sqlApp(`SELECT state || '|' || coalesce(applied_scheme, '') || '|' || coalesce(decision_note, '') FROM app.rating_scheme_proposal WHERE id = '${id}'`);
const baseline = () => sqlApp(`SELECT
  (SELECT count(*) || '/' || coalesce(string_agg(stars || ':' || min_iseer, ',' ORDER BY stars), '') FROM app.rating_demo_band WHERE scheme_key = 'RAC-ISEER-DEMO-1') || '|' ||
  (SELECT count(*) FROM app.model_application_rating) || '|' || (SELECT count(*) FROM app.model_application)`);
const inForceNow = () => sqlApp(`SELECT scheme_key FROM app.rating_demo_band WHERE category_code = 'RAC' AND effective_from <= (now() AT TIME ZONE 'Asia/Kolkata')::date ORDER BY effective_from DESC, scheme_key DESC LIMIT 1`);

async function pendingIdByReason(admin, reason) {
  const r = await api(admin, "GET", PATHS.read, null, null);
  return r.body?.pending?.find((p) => p.reason === reason)?.id ?? null;
}
const FIG = ["3.10", "3.45", "3.95", "4.45", "4.95"];
const proposeBody = (date, reason, extra = {}) => ({ categoryCode: "RAC", effectiveFrom: date, minIseer: FIG, sourceReference: "Live check", reason, ...extra });

async function runChecks(run, P, who) {
  const tag = crypto.randomUUID().slice(0, 8);
  const before = baseline();
  const PERSONA = { nova: "nova.applicant", admin: "bee.admin", finance: "bee.finance" };
  const twinIds = Object.values(PERSONA).map((u) => `'${ids.accountId(u)}'`).join(",");
  sqlMaint(`INSERT INTO app.capability_grant (capability, role) VALUES ('rating_scheme_manage', 'finance') ON CONFLICT DO NOTHING`);
  try {
    // 0. The menu follows the permission, not the role.
    const adminMenu = await menuOf(P.admin), financeMenu = await menuOf(P.finance);
    check(`${run}.menu.admin-has-both-admin-screens`, adminMenu.includes("fee-rules") && adminMenu.includes("rating-formula"), adminMenu.join(","));
    check(`${run}.menu.finance-gets-rating-schemes-once-granted`, financeMenu.includes("rating-formula") && !financeMenu.includes("fee-rules"), financeMenu.join(","));

    // 1. Someone without the permission sees and does nothing.
    let r = await api(P.nova, "GET", PATHS.read, null, null);
    check(`${run}.applicant.cannot-read`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.nova, "POST", PATHS.propose, proposeBody(await nextDate(), `nova-${tag}`), key());
    check(`${run}.applicant.cannot-propose`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    await open(P.nova, SCREEN, "schemes-error");
    check(`${run}.applicant.screen-shows-refusal`, !(await present(P.nova, "scheme-propose", 1500)), "no proposal form for the applicant");

    // 2. The Administrator reads the schemes.
    r = await api(P.admin, "GET", PATHS.read, null, null);
    const demo = r.body?.schemes?.find((s) => s.schemeKey === "RAC-ISEER-DEMO-1");
    check(`${run}.admin.reads-schemes`, r.status === 200 && demo?.inForce === true && demo?.bands?.length === 5 && demo.bands[0].minIseer === "3.30" && demo.bands[4].minIseer === "5.00", `demo in force, bands ${demo?.bands?.map((b) => b.minIseer).join(",")}`);
    await open(P.admin, SCREEN, "schemes-screen");
    await present(P.admin, "schemes-row-RAC-ISEER-DEMO-1");
    const row = await textOf(P.admin, "schemes-row-RAC-ISEER-DEMO-1");
    check(`${run}.admin.ui-shows-the-scheme`, /In force/.test(row) && /1★ 3\.30/.test(row) && /5★ 5\.00/.test(row), row.replace(/\s+/g, " ").slice(0, 100));
    const notes = await textOf(P.admin, "schemes-notes");
    check(`${run}.admin.ui-states-the-rules`, /different person approves/.test(notes) && /BEE-approved formula/.test(notes), "two people, never the past, a demonstration");

    // 3. Propose in the portal; the proposer can only withdraw, and the server refuses their own approval.
    const d1 = await nextDate();
    const reason1 = `ui-${tag}`;
    for (let i = 0; i < 5; i++) await setInput(P.admin, `scheme-min-${i + 1}`, FIG[i]);
    await setInput(P.admin, "scheme-from", d1);
    await setInput(P.admin, "scheme-source", "Live check circular");
    await setInput(P.admin, "scheme-reason", reason1, "HTMLTextAreaElement");
    await uiClick(P.admin, "scheme-propose-run");
    check(`${run}.admin.ui-propose-success`, await present(P.admin, "scheme-propose-success", 15000), (await textOf(P.admin, "scheme-propose-success")).slice(0, 100));
    const p1 = await pendingIdByReason(P.admin, reason1);
    check(`${run}.admin.proposal-pending-in-db`, p1 && (await proposalRow(p1)).startsWith("pending"), `${p1} ${p1 ? await proposalRow(p1) : ""}`);
    await present(P.admin, `schemes-pending-${p1}`);
    const own = await P.admin.eval(`(() => { const li = document.querySelector('[data-testid="schemes-pending-${p1}"]'); return [li?.getAttribute('data-proposed-by-you'), !!document.querySelector('[data-testid="scheme-withdraw-run-${p1}"]'), !!document.querySelector('[data-testid="scheme-approve-run-${p1}"]')].join(','); })()`);
    check(`${run}.admin.own-proposal-only-withdraw`, own === "true,true,false", own);
    r = await api(P.admin, "POST", PATHS.decide(p1), { decision: "approve" }, key());
    check(`${run}.admin.cannot-approve-own`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);
    r = await api(P.admin, "POST", PATHS.decide(p1), { decision: "reject" }, key());
    check(`${run}.admin.cannot-reject-own`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);

    // 4. Input rules.
    const past = sqlApp(`SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1)::text`);
    for (const [label, b] of [["past-date", proposeBody(past, `x-${tag}`)], ["unknown-category", proposeBody(d1, `x-${tag}`, { categoryCode: "ZZ" })],
      ["figures-that-do-not-rise", proposeBody(d1, `x-${tag}`, { minIseer: ["3.10", "3.10", "3.95", "4.45", "4.95"] })], ["four-figures", proposeBody(d1, `x-${tag}`, { minIseer: FIG.slice(0, 4) })],
      ["three-decimals", proposeBody(d1, `x-${tag}`, { minIseer: ["3.105", "3.45", "3.95", "4.45", "4.95"] })], ["blank-reason", proposeBody(d1, "   ")]]) {
      r = await api(P.admin, "POST", PATHS.propose, b, key());
      check(`${run}.admin.refuses-${label}`, r.status === 422 && r.body?.error === "validation_failed", `${r.status} ${r.body?.error}`);
    }
    r = await api(P.admin, "POST", PATHS.propose, proposeBody(d1, `x-${tag}`), null);
    check(`${run}.admin.key-required`, r.status === 422 && r.body?.error === "idempotency_key_required", `${r.status} ${r.body?.error}`);

    // 5. A different person approves in the portal: the scheme is added with its five bands from the date.
    await open(P.finance, SCREEN, "schemes-screen");
    await present(P.finance, `schemes-pending-${p1}`);
    const colleague = await P.finance.eval(`[!!document.querySelector('[data-testid="scheme-approve-run-${p1}"]'), !!document.querySelector('[data-testid="scheme-reject-run-${p1}"]'), !!document.querySelector('[data-testid="scheme-withdraw-run-${p1}"]')].join(',')`);
    check(`${run}.finance.sees-approve-and-reject-not-withdraw`, colleague === "true,true,false", colleague);
    await setInput(P.finance, `scheme-note-${p1}`, `ok-${tag}`);
    await uiClick(P.finance, `scheme-approve-run-${p1}`);
    check(`${run}.finance.ui-approve-success`, await present(P.finance, `scheme-decided-${p1}`, 15000), (await textOf(P.finance, `scheme-decided-${p1}`)).slice(0, 90));
    const [st, key1] = (await proposalRow(p1)).split("|");
    const bands = sqlApp(`SELECT string_agg(stars || ':' || min_iseer || ':' || effective_from, ',' ORDER BY stars) FROM app.rating_demo_band WHERE scheme_key = '${key1}'`);
    check(`${run}.db.scheme-added-from-the-date`, st === "approved" && bands === FIG.map((m, i) => `${i + 1}:${m}:${d1}`).join(","), `${st} ${key1} ${bands}`);
    check(`${run}.db.approved-by-the-other-person`, sqlApp(`SELECT decided_by = '${ids.accountId(PERSONA.finance)}' AND proposed_by = '${ids.accountId(PERSONA.admin)}' FROM app.rating_scheme_proposal WHERE id = '${p1}'`) === "t", "decided_by is Finance, proposed_by is the Administrator");
    r = await api(P.finance, "POST", PATHS.decide(p1), { decision: "approve" }, key());
    check(`${run}.finance.decided-is-final`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);

    // 6. A second scheme on the same day is refused; a later one is added; neither disturbs the scheme that applies today.
    const c = await api(P.admin, "POST", PATHS.propose, proposeBody(d1, `c-${tag}`), key());
    r = await api(P.finance, "POST", PATHS.decide(c.body.id), { decision: "approve" }, key());
    check(`${run}.finance.same-day-refused`, r.status === 409 && r.body?.error === "rule_conflict" && (await proposalRow(c.body.id)).startsWith("pending"), `${r.status} ${r.body?.error} ${await proposalRow(c.body.id)}`);
    await api(P.admin, "POST", PATHS.decide(c.body.id), { decision: "withdraw" }, key());
    const d2 = await addDays(d1, 10);
    const n = await api(P.admin, "POST", PATHS.propose, proposeBody(d2, `n-${tag}`), key());
    check(`${run}.admin.api-propose-201`, n.status === 201 && n.body?.state === "pending" && n.body?.proposedByYou === true, `${n.status} ${n.body?.state}`);
    r = await api(P.finance, "POST", PATHS.decide(n.body.id), { decision: "approve", note: "ok" }, key());
    check(`${run}.finance.api-approve-200`, r.status === 200 && r.body?.state === "approved" && /^RAC-ISEER-\d+$/.test(r.body?.appliedScheme ?? ""), `${r.status} ${r.body?.state} ${r.body?.appliedScheme}`);
    check(`${run}.db.the-rating-step-still-uses-the-scheme-in-force-today`, (await inForceNow()) === "RAC-ISEER-DEMO-1", "RAC-ISEER-DEMO-1 until a scheme's own date");

    // 7. Replay, withdraw, reject.
    const reason3 = `replay-${tag}`;
    const k3 = key();
    const d3 = await addDays(d1, 20);
    const first = await api(P.admin, "POST", PATHS.propose, proposeBody(d3, reason3), k3);
    const again = await api(P.admin, "POST", PATHS.propose, proposeBody(d3, reason3), k3);
    check(`${run}.admin.replay-is-the-same-proposal`, first.status === 201 && again.status === 201 && again.replay === "true" && again.body?.id === first.body?.id, `${again.status} replay=${again.replay}`);
    r = await api(P.admin, "POST", PATHS.propose, proposeBody(d3, `${reason3}-other`), k3);
    check(`${run}.admin.key-reuse-with-other-body-conflicts`, r.status === 409 && r.body?.error === "idempotency_key_conflict", `${r.status} ${r.body?.error}`);
    await open(P.admin, SCREEN, "schemes-screen");
    await present(P.admin, `scheme-withdraw-run-${first.body.id}`);
    await uiClick(P.admin, `scheme-withdraw-run-${first.body.id}`);
    check(`${run}.admin.ui-withdraw`, await present(P.admin, `scheme-decided-${first.body.id}`, 15000) && (await proposalRow(first.body.id)).startsWith("withdrawn"), await proposalRow(first.body.id));
    r = await api(P.finance, "POST", PATHS.decide(first.body.id), { decision: "approve" }, key());
    check(`${run}.finance.cannot-approve-a-withdrawn-one`, r.status === 409 && r.body?.error === "proposal_not_pending", `${r.status} ${r.body?.error}`);
    const w = await api(P.admin, "POST", PATHS.propose, proposeBody(d3, `w-${tag}`), key());
    r = await api(P.finance, "POST", PATHS.decide(w.body.id), { decision: "withdraw" }, key());
    check(`${run}.finance.cannot-withdraw-another's`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    await open(P.finance, SCREEN, "schemes-screen");
    await present(P.finance, `scheme-reject-run-${w.body.id}`);
    await setInput(P.finance, `scheme-note-${w.body.id}`, `no-${tag}`);
    await uiClick(P.finance, `scheme-reject-run-${w.body.id}`);
    check(`${run}.finance.ui-reject-with-note`, await present(P.finance, `scheme-decided-${w.body.id}`, 15000) && (await proposalRow(w.body.id)) === `rejected||no-${tag}`, await proposalRow(w.body.id));

    // 8. The permission follows the role it is granted to.
    sqlMaint(`DELETE FROM app.capability_grant WHERE capability = 'rating_scheme_manage' AND role = 'finance'`);
    const m = await api(P.admin, "POST", PATHS.propose, proposeBody(await addDays(d1, 30), `m-${tag}`), key());
    r = await api(P.finance, "POST", PATHS.decide(m.body.id), { decision: "approve" }, key());
    check(`${run}.finance.refused-once-the-permission-is-removed`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    r = await api(P.finance, "GET", PATHS.read, null, null);
    check(`${run}.finance.cannot-read-once-removed`, r.status === 403, `${r.status}`);
    const goneMenu = await menuOf(P.finance);
    check(`${run}.menu.finance-loses-the-entry-once-removed`, !goneMenu.includes("rating-formula"), goneMenu.join(","));
    await api(P.admin, "POST", PATHS.decide(m.body.id), { decision: "withdraw" }, key());

    // 9. Nothing a rating uses has moved.
    const after = baseline();
    check(`${run}.real-bands-and-ratings-unchanged`, before === after, before === after ? "RAC-ISEER-DEMO-1, the ratings and the applications unchanged" : `drift ${before} vs ${after}`);
  } finally {
    sqlMaint(`DELETE FROM app.rating_scheme_proposal WHERE proposed_by IN (${twinIds}); DELETE FROM app.capability_grant WHERE capability = 'rating_scheme_manage' AND role = 'finance'`);
  }
}

async function main() {
  const chrome = await launchChrome();
  try {
    const who = { nova: ids.name("nova.applicant"), admin: ids.name("bee.admin"), finance: ids.name("bee.finance") };
    const P = {};
    for (const [k, u] of Object.entries(who)) {
      await totp.ensureEnrolled(u);
      P[k] = await openPage(chrome.cdp);
      if (!(await signIn(P[k], u))) throw new Error(`${k} sign-in failed`);
    }
    await runChecks("schemes.run1", P, who);
    await runChecks("schemes.run2", P, who);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("schemes.run", false, String(e.message)))
  .then(() => {
    console.log(`rating-schemes checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
