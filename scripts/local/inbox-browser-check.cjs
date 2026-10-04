/* eslint-disable */
/** Wave 1: the inbox ("My work") and "My approvals": each person sees the applications waiting for them, with the action and a link to the screen where it is done; read-only, baseline-preserving, run twice. */
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");

const NOVA_ORG = "00000000-0000-4000-b000-000000000001";
const env = (k, d) => process.env[k] || d;
let pass = 0, fail = 0;
function check(id, ok, detail) { const r = ok ? "PASS" : "FAIL"; ok ? pass++ : fail++; console.log(`${r.padEnd(4)} ${id.padEnd(46)} ${detail}`); }

function psql(user, pw, q) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${pw}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", user, "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
}
const sqlApp = (q) => psql("bee_app", env("BEE_APP_DB_PASSWORD", "bee-local-app"), q);
const sqlMaint = (q) => psql(env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint"), q);
const baseline = () => sqlApp("SELECT count(*)::text || '|' || coalesce(string_agg(reference || ':' || state || ':' || version, ',' ORDER BY reference), '') FROM app.model_application");

const present = (page, testId, ms = 20000) => page.waitFor(`!!document.querySelector('[data-testid=${testId}]')`, ms);
const refsOf = (page, prefix) => page.eval(`[...document.querySelectorAll('[data-testid^="${prefix}-ref-"]')].map((e) => e.textContent.trim()).sort()`);
const hrefOf = (page, prefix, ref) => page.eval(`document.querySelector('[data-testid="${prefix}-open-${ref}"]')?.getAttribute("href") ?? ""`);
const rowText = (page, prefix, ref) => page.eval(`document.querySelector('[data-testid="${prefix}-ref-${ref}"]')?.closest("tr")?.textContent ?? ""`);

async function open(page, route, prefix, settle) {
  await page.goto(`${WEB}${route}`);
  return page.waitFor(`!!document.querySelector('[data-testid="${prefix}-table"], [data-testid="${prefix}-empty"], [data-testid="${prefix}-error"]')`, 30000);
}

const DISPOSABLE = [["LOCAL-MA-9101", "rating"], ["LOCAL-MA-9102", "director_review"], ["LOCAL-MA-9103", "secretary_approval"]];

async function runChecks(run, pages) {
  const created = DISPOSABLE.map(([ref, state]) => ({ id: crypto.randomUUID(), ref, state }));
  const before = baseline();
  try {
    const brand = sqlApp(`SELECT brand_id FROM app.model_application WHERE reference = 'LOCAL-MA-0001'`);
    for (const c of created) {
      sqlApp(`INSERT INTO app.model_application (id, reference, organisation_id, principal_organisation_id, brand_id, brand_name, category, model_number, state, version) SELECT '${c.id}', '${c.ref}', organisation_id, principal_organisation_id, brand_id, brand_name, category, 'INBOX-${c.ref}', '${c.state}', 3 FROM app.model_application WHERE reference = 'LOCAL-MA-0001'`);
      sqlMaint(`SELECT set_config('bee.cleanup_schema', 'app', true); INSERT INTO app.local_disposable_application (application_id) VALUES ('${c.id}') ON CONFLICT DO NOTHING`);
    }

    // The applicant: only the draft is waiting for them; the fee, scrutiny and stage-owner states are not theirs to act on.
    check(`${run}.applicant.inbox-loads`, await open(pages.nova, "/app/workflow/personal-inbox", "inbox"), "inbox shows a table or an empty note");
    const novaRefs = await refsOf(pages.nova, "inbox");
    check(`${run}.applicant.only-own-actionable`, novaRefs.length === 1 && novaRefs[0] === "LOCAL-MA-0001", `tasks: ${novaRefs.join(",")}`);
    check(`${run}.applicant.task-text`, /Finish and submit/.test(await rowText(pages.nova, "inbox", "LOCAL-MA-0001")), "draft: Finish and submit");
    const dash = await hrefOf(pages.nova, "inbox", "LOCAL-MA-0001");
    check(`${run}.applicant.link-to-dashboard`, dash.startsWith("/app/model-label/model-dashboard?id="), dash);
    check(`${run}.applicant.approvals-empty`, (await open(pages.nova, "/app/workflow/my-approvals", "approvals")) && !!(await present(pages.nova, "approvals-empty")), "nothing is waiting for the applicant's decision");

    // Finance: the one fee due.
    await open(pages.finance, "/app/workflow/personal-inbox", "inbox");
    const finRefs = await refsOf(pages.finance, "inbox");
    check(`${run}.finance.fee-due-only`, finRefs.length === 1 && finRefs[0] === "LOCAL-MA-0002", `tasks: ${finRefs.join(",")}`);
    check(`${run}.finance.link-to-queue`, (await hrefOf(pages.finance, "inbox", "LOCAL-MA-0002")).startsWith("/app/finance/finance-queue?id="), "fee confirmation");

    // Programme owns the rating stage, Director the director stage, Secretary the secretary stage.
    await open(pages.programme, "/app/workflow/personal-inbox", "inbox");
    const prg = await refsOf(pages.programme, "inbox");
    check(`${run}.programme.rating-only`, prg.join(",") === "LOCAL-MA-9101", `tasks: ${prg.join(",")}`);
    check(`${run}.programme.link`, (await hrefOf(pages.programme, "inbox", "LOCAL-MA-9101")).startsWith("/app/model-label/rating-calculation?id="), "rating screen");
    check(`${run}.programme.no-approvals`, (await open(pages.programme, "/app/workflow/my-approvals", "approvals")) && !!(await present(pages.programme, "approvals-empty")), "rating is not an approval");

    await open(pages.director, "/app/workflow/my-approvals", "approvals");
    const dir = await refsOf(pages.director, "approvals");
    check(`${run}.director.approvals`, dir.join(",") === "LOCAL-MA-9102", `approvals: ${dir.join(",")}`);
    check(`${run}.director.link`, (await hrefOf(pages.director, "approvals", "LOCAL-MA-9102")).startsWith("/app/model-label/director-approval?id="), "approval screen");
    await open(pages.director, "/app/workflow/personal-inbox", "inbox");
    check(`${run}.director.inbox-matches`, (await refsOf(pages.director, "inbox")).join(",") === "LOCAL-MA-9102", "same task in the inbox");

    await open(pages.secretary, "/app/workflow/my-approvals", "approvals");
    const sec = await refsOf(pages.secretary, "approvals");
    check(`${run}.secretary.approvals`, sec.join(",") === "LOCAL-MA-9103", `approvals: ${sec.join(",")}`);
    check(`${run}.secretary.task-text`, /Give final approval/.test(await rowText(pages.secretary, "approvals", "LOCAL-MA-9103")), "final approval");

    // Menu entries come from the Spring identity.
    const menu = (page) => page.eval(`[...document.querySelectorAll('[data-testid^="runtime-nav-"]')].map((e) => e.getAttribute("data-testid").replace("runtime-nav-", ""))`);
    const dm = await menu(pages.director), nm = await menu(pages.nova);
    check(`${run}.menu.director-has-both`, dm.includes("personal-inbox") && dm.includes("my-approvals"), dm.join(","));
    check(`${run}.menu.applicant-inbox-only`, nm.includes("personal-inbox") && !nm.includes("my-approvals"), nm.join(","));
  } finally {
    const arr = created.map((c) => `'${c.id}'`).join(",");
    sqlMaint(`SELECT set_config('bee.cleanup_schema', 'app', true); SELECT app.app_disposable_model_cleanup(ARRAY[${arr}]::uuid[])`);
  }
  const after = baseline();
  check(`${run}.baseline-preserved`, before === after, before === after ? "seed rows unchanged" : "drift");
}

async function main() {
  const chrome = await launchChrome();
  try {
    const people = [["nova", "nova.applicant"], ["finance", "bee.finance"], ["programme", "bee.programme"], ["director", "bee.director"], ["secretary", "bee.secretary"]];
    const pages = {};
    for (const [k, u] of people) {
      const twin = ids.name(u);
      await totp.ensureEnrolled(twin);
      pages[k] = await openPage(chrome.cdp);
      if (!(await signIn(pages[k], twin))) throw new Error(`${k} sign-in failed`);
    }
    await runChecks("inbox.run1", pages);
    await runChecks("inbox.run2", pages);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("inbox.run", false, String(e.message)))
  .then(() => {
    console.log(`inbox checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
