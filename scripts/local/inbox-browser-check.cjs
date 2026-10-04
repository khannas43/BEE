/* eslint-disable */
/** Wave 1: the inbox ("My work"), "My approvals" and the review, history and escalation views: each person sees the applications waiting for them, with the action and a link to the screen where it is done; read-only, baseline-preserving, run twice. */
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

const page_goto = (page, route) => page.goto(`${WEB}${route}`);
const page_wait = (page, expr) => page.waitFor(expr, 30000);
const page_counts = (page) => page.eval(`[...document.querySelectorAll('[data-testid^="escalation-count-"]')].map((e) => e.getAttribute('data-testid').replace('escalation-count-', '') + '=' + e.textContent.trim()).join(',')`);

async function open(page, route, prefix, settle) {
  await page.goto(`${WEB}${route}`);
  return page.waitFor(`!!document.querySelector('[data-testid="${prefix}-table"], [data-testid="${prefix}-counts"], [data-testid="${prefix}-empty"], [data-testid="${prefix}-error"]')`, 30000);
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

    // Application review, workflow history and escalations: the same scoped list, arranged for reading.
    const text = (page, sel) => page.eval(`document.querySelector('${sel}')?.textContent ?? ""`);
    await open(pages.director, "/app/workflow/application-review", "review");
    const dRev = await refsOf(pages.director, "review");
    check(`${run}.review.director-sees-own-stage`, dRev.join(",") === "LOCAL-MA-9102", `rows: ${dRev.join(",")}`);
    check(`${run}.review.director-next-action`, /Recommend a decision/.test(await text(pages.director, '[data-testid="review-action-LOCAL-MA-9102"]')), "link to the approval screen");
    await open(pages.nova, "/app/workflow/application-review", "review");
    const nRev = await refsOf(pages.nova, "review");
    check(`${run}.review.applicant-no-draft-no-finished`, !nRev.includes("LOCAL-MA-0001") && nRev.includes("LOCAL-MA-0002") && nRev.includes("LOCAL-MA-9101"), `rows: ${nRev.join(",")}`);
    check(`${run}.review.applicant-has-no-action-on-officer-stages`, /None for you/.test(await text(pages.nova, '[data-testid="review-action-LOCAL-MA-9101"]')), "nothing for the applicant to do at rating");
    await open(pages.finance, "/app/workflow/application-review", "review");
    check(`${run}.review.finance-fee-action`, /Confirm the fee was received/.test(await text(pages.finance, '[data-testid="review-action-LOCAL-MA-0002"]')), "fee confirmation");

    await open(pages.nova, "/app/workflow/workflow-history", "wfh");
    const wfhRefs = await refsOf(pages.nova, "wfh");
    check(`${run}.history.lists-visible-applications`, wfhRefs.includes("LOCAL-MA-0001") && wfhRefs.includes("LOCAL-MA-9102"), `rows: ${wfhRefs.length}`);
    const target = sqlApp(`SELECT id FROM app.model_application WHERE reference = 'LOCAL-MA-0002'`);
    await page_goto(pages.nova, `/app/workflow/workflow-history?id=${target}`);
    check(`${run}.history.shows-the-selected-history`, !!(await page_wait(pages.nova, `!!document.querySelector('[data-testid="wfh-history-list"], [data-testid="wfh-history-empty"]')`)), "history for the selected application");
    check(`${run}.history.selected-marker`, (await text(pages.nova, '[data-testid="wfh-open-LOCAL-MA-0002"]')).trim() === "Selected", "Selected");

    await open(pages.director, "/app/workflow/escalation-dashboard", "escalation");
    const dCount = await text(pages.director, '[data-testid="escalation-count-director_review"]');
    check(`${run}.escalation.director-counts`, dCount.trim() === "1", `director_review=${dCount.trim()}`);
    check(`${run}.escalation.states-no-limits`, /No time limits are set/.test(await text(pages.director, '[data-testid="escalation-no-limits"]')), "nothing is called late");
    await open(pages.nova, "/app/workflow/escalation-dashboard", "escalation");
    const counts = await page_counts(pages.nova);
    check(`${run}.escalation.applicant-counts`, counts === "fee_due=1,iame_scrutiny=0,bee_scrutiny=1,rating=1,director_review=1,secretary_approval=1,returned=0", counts);

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
