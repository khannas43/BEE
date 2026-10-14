/* eslint-disable */
/** Business settings screen (WP08.1h, Brief 12), driven in the portal. The menu follows the permission, the screen lists every definition with its default label, the form takes its range, unit and warning from the definition, a whole-number setting takes no decimal point, a proposal is refused in the browser before it is sent, a proposal is pending and its proposer can only withdraw it, a DIFFERENT person approves or rejects it in the screen, and a removed permission takes the entry and the screen away. Versions start in the year 2100 so they never apply to a real action; run twice. The API rules have their own check (business-settings-browser-check.cjs). */
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
function check(id, ok, detail) { const r = ok ? "PASS" : "FAIL"; ok ? pass++ : fail++; console.log(`${r.padEnd(4)} ${id.padEnd(56)} ${detail}`); }

function psql(user, pw, q) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${pw}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", user, "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-c", q]).toString().trim();
}
const sqlApp = (q) => psql("bee_app", env("BEE_APP_DB_PASSWORD", "bee-local-app"), q);
const sqlMaint = (q) => psql(env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint"), q);

const PATHS = { read: `${WEB}/api/runtime/business-settings`, propose: `${WEB}/api/runtime/business-settings/proposals`, decide: (id) => `${WEB}/api/runtime/business-settings/proposals/${id}/decision` };
const SCREEN = "/app/administration/business-settings";
const routeOf = (path) => (path.endsWith("/decision") ? "/api/runtime/business-settings/proposals/{id}/decision" : path.endsWith("/proposals") ? "/api/runtime/business-settings/proposals" : "/api/runtime/business-settings");

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
async function setInput(page, testId, value, kind = "HTMLInputElement") {
  await page.eval(`(() => {
    const el = document.querySelector('[data-testid=${testId}]');
    const s = Object.getOwnPropertyDescriptor(window.${kind}.prototype, 'value').set;
    s.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
}
const uiClick = (page, testId) => page.eval(`document.querySelector('[data-testid="${testId}"]').click(); true`);
const present = (page, testId, ms = 20000) => page.waitFor(`!!document.querySelector('[data-testid="${testId}"]')`, ms);
const textOf = (page, testId) => page.eval(`document.querySelector('[data-testid="${testId}"]')?.textContent?.replace(/\\s+/g, " ").trim() ?? ""`);
const valueOf = (page, testId) => page.eval(`document.querySelector('[data-testid="${testId}"]')?.value ?? null`);
const attrOf = (page, testId, name) => page.eval(`document.querySelector('[data-testid="${testId}"]')?.getAttribute(${JSON.stringify(name)})`);
const exists = (page, testId) => page.eval(`!!document.querySelector('[data-testid="${testId}"]')`);

async function open(page, readyTestId) {
  await page.goto(`${WEB}${SCREEN}`);
  return present(page, readyTestId, 30000);
}
/** The runtime menu entries a person sees on a fresh page load (the identity, with its permissions, is read once per load). */
async function menuOf(page) {
  await page.goto(`${WEB}/app`);
  await present(page, "runtime-nav", 30000);
  return page.eval(`[...document.querySelectorAll('[data-testid^="runtime-nav-"]')].map((e) => e.getAttribute("data-testid").replace("runtime-nav-", ""))`);
}

const FAR = "2100-01-01";
const DEC_KEY = "payment_tolerance_amount";
const WHOLE_KEY = "certificate_validity_years";
const nextDate = (k) => sqlApp(`SELECT (coalesce(max(effective_from) FILTER (WHERE effective_from >= DATE '${FAR}'), DATE '${FAR}' - 1) + 1)::text FROM app.business_setting_version WHERE setting_key = '${k}'`);
const addDays = (d, n) => sqlApp(`SELECT (DATE '${d}' + ${n})::text`);
const proposalRow = (id) => sqlApp(`SELECT state || '|' || (applied_version IS NOT NULL)::text || '|' || coalesce(decision_note, '') FROM app.business_setting_proposal WHERE id = '${id}'`);
const proposalCount = () => sqlApp(`SELECT count(*) FROM app.business_setting_proposal`);
const valuesInForce = () => sqlApp(`SELECT string_agg(setting_key || '=' || app.business_setting_value(setting_key, (now() AT TIME ZONE 'Asia/Kolkata')::date), ',' ORDER BY setting_key) FROM app.business_setting_def`);
const baseline = () => sqlApp(`SELECT (SELECT count(*) FROM app.model_application_rating) || '|' || (SELECT count(*) FROM app.model_application) || '|' || (SELECT count(*) FROM app.certificate)`);

async function pendingIdByReason(page, reason) {
  const r = await api(page, "GET", PATHS.read, null, null);
  return r.body?.pending?.find((p) => p.reason === reason)?.id ?? null;
}
const settingOf = async (page, k) => (await api(page, "GET", PATHS.read, null, null)).body?.settings?.find((s) => s.key === k);

async function fillAndPropose(page, { value, from, source, reason }) {
  await setInput(page, "bizsetting-value", value);
  if (from) await setInput(page, "bizsetting-from", from);
  await setInput(page, "bizsetting-source", source);
  await setInput(page, "bizsetting-reason", reason, "HTMLTextAreaElement");
  await uiClick(page, "bizsetting-propose-run");
}

async function runChecks(run, P) {
  const tag = crypto.randomUUID().slice(0, 8);
  const before = baseline();
  const inForceBefore = valuesInForce();
  const PERSONA = { nova: "nova.applicant", admin: "bee.admin", finance: "bee.finance" };
  const twinIds = Object.values(PERSONA).map((u) => `'${ids.accountId(u)}'`).join(",");
  sqlMaint(`INSERT INTO app.capability_grant (capability, role) VALUES ('business_setting_manage', 'finance') ON CONFLICT DO NOTHING`);
  try {
    // 0. The menu follows the permission, not the role.
    const adminMenu = await menuOf(P.admin), novaMenu = await menuOf(P.nova), financeMenu = await menuOf(P.finance);
    check(`${run}.menu.admin-has-business-settings`, adminMenu.includes("business-settings"), adminMenu.join(","));
    check(`${run}.menu.applicant-has-no-entry`, !novaMenu.includes("business-settings"), novaMenu.join(","));
    check(`${run}.menu.finance-gets-it-once-granted`, financeMenu.includes("business-settings"), financeMenu.join(","));

    // 1. Someone without the permission gets the refusal and no form.
    await open(P.nova, "bizsettings-error");
    check(`${run}.applicant.screen-shows-refusal-and-no-form`, !(await exists(P.nova, "bizsetting-propose")) && !(await exists(P.nova, "bizsettings-table")), (await textOf(P.nova, "bizsettings-error")).slice(0, 90));

    // 2. The Administrator sees every definition with its value in force.
    await open(P.admin, "bizsettings-table");
    const api0 = await api(P.admin, "GET", PATHS.read, null, null);
    const defs = api0.body?.settings ?? [];
    const rowsShown = await P.admin.eval(`[...document.querySelectorAll('[data-testid^="bizsetting-row-"]')].map((e) => e.getAttribute("data-testid").replace("bizsetting-row-", ""))`);
    check(`${run}.admin.ui-lists-every-definition`, defs.length === 5 && defs.every((d) => rowsShown.includes(d.key)) && rowsShown.length === defs.length, rowsShown.join(","));
    const allDefaultLabelled = [];
    for (const d of defs.filter((x) => x.inForceFrom === null)) {
      const cell = await textOf(P.admin, `bizsetting-value-${d.key}`);
      allDefaultLabelled.push(cell.includes(d.defaultValue) && cell.includes("default, not a BEE rule") && (await attrOf(P.admin, `bizsetting-value-${d.key}`, "data-default")) === "true");
    }
    check(`${run}.admin.ui-labels-every-default`, allDefaultLabelled.length > 0 && allDefaultLabelled.every(Boolean), `${allDefaultLabelled.length} defaults labelled`);
    check(`${run}.admin.ui-states-the-rules`, /different person approves/.test(await textOf(P.admin, "bizsettings-notes")) && /not a BEE rule/.test(await textOf(P.admin, "bizsettings-notes")), "two people, never the past, an assumption");

    // 3. The form takes its range, unit, note and warning from the definition.
    const dec = await settingOf(P.admin, DEC_KEY), whole = await settingOf(P.admin, WHOLE_KEY);
    await uiClick(P.admin, `bizsetting-propose-${DEC_KEY}`);
    await present(P.admin, "bizsetting-propose");
    check(`${run}.admin.form-shows-range-unit-and-note`, (await textOf(P.admin, "bizsetting-min")) === dec.min && (await textOf(P.admin, "bizsetting-max")) === dec.max && (await textOf(P.admin, "bizsetting-unit")) === dec.unit && (await textOf(P.admin, "bizsetting-description")) === dec.description.trim(), `${dec.min} to ${dec.max} ${dec.unit}`);
    check(`${run}.admin.form-warning-follows-the-definition`, (await exists(P.admin, "bizsetting-warning")) === (dec.warning !== null), `warning ${dec.warning === null ? "absent" : "shown"} for ${DEC_KEY}`);
    const tomorrow = await addDays(api0.body.today, 1);
    check(`${run}.admin.start-date-defaults-to-tomorrow`, (await valueOf(P.admin, "bizsetting-from")) === tomorrow && (await attrOf(P.admin, "bizsetting-from", "min")) === api0.body.today, `${tomorrow}, earliest ${api0.body.today}`);
    check(`${run}.admin.decimal-field-is-decimal`, (await attrOf(P.admin, "bizsetting-value", "inputmode")) === "decimal" && (await attrOf(P.admin, "bizsetting-value", "data-decimals")) === "2", "inputmode decimal");

    // 4. A whole-number setting takes no decimal point; the form shows its own warning.
    await uiClick(P.admin, `bizsetting-propose-${WHOLE_KEY}`);
    await P.admin.waitFor(`document.querySelector('[data-testid="bizsetting-unit"]')?.textContent === ${JSON.stringify(whole.unit)}`, 10000);
    check(`${run}.admin.whole-field-is-numeric`, (await attrOf(P.admin, "bizsetting-value", "inputmode")) === "numeric" && (await attrOf(P.admin, "bizsetting-value", "data-decimals")) === "0", "inputmode numeric");
    await setInput(P.admin, "bizsetting-value", "2.5");
    check(`${run}.admin.whole-field-rejects-a-decimal-point`, (await valueOf(P.admin, "bizsetting-value")) === "", `field holds "${await valueOf(P.admin, "bizsetting-value")}"`);
    check(`${run}.admin.whole-form-warning-follows-the-definition`, (await exists(P.admin, "bizsetting-warning")) === (whole.warning !== null), `warning ${whole.warning === null ? "absent" : "shown"} for ${WHOLE_KEY}`);

    // 5. An incomplete or out-of-range proposal is refused in the browser and never sent.
    const countBefore = await proposalCount();
    await fillAndPropose(P.admin, { value: String(Number(whole.max) + 1), source: "Live check", reason: `bad-${tag}` });
    check(`${run}.admin.out-of-range-not-sent`, (await present(P.admin, "bizsetting-propose-input-error", 5000)) && (await proposalCount()) === countBefore, (await textOf(P.admin, "bizsetting-propose-input-error")).slice(0, 80));
    await fillAndPropose(P.admin, { value: whole.min, source: "", reason: `bad-${tag}` });
    check(`${run}.admin.missing-source-not-sent`, (await proposalCount()) === countBefore && (await exists(P.admin, "bizsetting-propose-input-error")), "no source, nothing sent");

    // 6. Propose through the screen: pending, shown as a summary, and its proposer can only withdraw it.
    await uiClick(P.admin, `bizsetting-propose-${DEC_KEY}`);
    await P.admin.waitFor(`document.querySelector('[data-testid="bizsetting-unit"]')?.textContent === ${JSON.stringify(dec.unit)}`, 10000);
    const d1 = await nextDate(DEC_KEY);
    const reason1 = `ui-${tag}`;
    await fillAndPropose(P.admin, { value: "7.00", from: d1, source: "Live check circular", reason: reason1 });
    check(`${run}.admin.ui-propose-success`, await present(P.admin, "bizsetting-propose-success", 15000), (await textOf(P.admin, "bizsetting-propose-success")).slice(0, 110));
    const p1 = await pendingIdByReason(P.admin, reason1);
    check(`${run}.db.proposal-pending`, p1 && (await proposalRow(p1)).startsWith("pending"), `${p1} ${p1 ? await proposalRow(p1) : ""}`);
    await present(P.admin, `bizsettings-pending-${p1}`);
    const created = (await api(P.admin, "GET", PATHS.read, null, null)).body.pending.find((x) => x.id === p1);
    const summary = await textOf(P.admin, `bizsettings-pending-${p1}`);
    check(`${run}.admin.ui-summary-prints-before-and-after`, summary.includes(`${created.label}: ${created.valueBefore} → ${created.value} from ${d1}`), summary.slice(0, 100));
    const own = await P.admin.eval(`[${JSON.stringify("")}, !!document.querySelector('[data-testid="bizsetting-withdraw-run-${p1}"]'), !!document.querySelector('[data-testid="bizsetting-approve-run-${p1}"]'), !!document.querySelector('[data-testid="bizsetting-reject-run-${p1}"]')].slice(1).join(',')`);
    check(`${run}.admin.own-proposal-only-withdraw`, (await attrOf(P.admin, `bizsettings-pending-${p1}`, "data-proposed-by-you")) === "true" && own === "true,false,false", own);
    let r = await api(P.admin, "POST", PATHS.decide(p1), { decision: "approve" }, key());
    check(`${run}.admin.server-refuses-own-approval`, r.status === 403 && r.body?.error === "segregation_refused", `${r.status} ${r.body?.error}`);

    // 7. A different person approves in the screen: the value is scheduled from the date and nothing in force moves.
    await open(P.finance, "bizsettings-table");
    await present(P.finance, `bizsettings-pending-${p1}`);
    const colleague = await P.finance.eval(`[!!document.querySelector('[data-testid="bizsetting-approve-run-${p1}"]'), !!document.querySelector('[data-testid="bizsetting-reject-run-${p1}"]'), !!document.querySelector('[data-testid="bizsetting-withdraw-run-${p1}"]')].join(',')`);
    check(`${run}.finance.sees-approve-and-reject-not-withdraw`, colleague === "true,true,false", colleague);
    await setInput(P.finance, `bizsetting-note-${p1}`, `ok-${tag}`);
    await uiClick(P.finance, `bizsetting-approve-run-${p1}`);
    check(`${run}.finance.ui-approve-success`, await present(P.finance, `bizsetting-decided-${p1}`, 15000), (await textOf(P.finance, `bizsetting-decided-${p1}`)).slice(0, 100));
    check(`${run}.db.version-starts-on-the-date`, (await proposalRow(p1)).startsWith("approved|true") && sqlApp(`SELECT value::text || '|' || effective_from FROM app.business_setting_version WHERE setting_key = '${DEC_KEY}' AND effective_from = DATE '${d1}'`) === `7.00|${d1}`, `7.00 from ${d1}`);
    check(`${run}.db.approved-by-the-other-person`, sqlApp(`SELECT decided_by = '${ids.accountId(PERSONA.finance)}' AND proposed_by = '${ids.accountId(PERSONA.admin)}' FROM app.business_setting_proposal WHERE id = '${p1}'`) === "t", "decided_by Finance, proposed_by Administrator");
    await present(P.finance, `bizsetting-scheduled-${DEC_KEY}-${d1}`, 15000);
    check(`${run}.finance.ui-lists-it-as-scheduled-not-in-force`, (await textOf(P.finance, `bizsetting-scheduled-${DEC_KEY}-${d1}`)).includes(`7.00`) && (await attrOf(P.finance, `bizsetting-value-${DEC_KEY}`, "data-default")) === "true", `scheduled from ${d1}; value in force unchanged`);

    // 8. A second value on the same day is refused through the kit's conflict failure and stays pending.
    const reasonC = `c-${tag}`;
    await open(P.admin, "bizsettings-table");
    await uiClick(P.admin, `bizsetting-propose-${DEC_KEY}`);
    await present(P.admin, "bizsetting-propose");
    await fillAndPropose(P.admin, { value: "9.00", from: d1, source: "Live check", reason: reasonC });
    await present(P.admin, "bizsetting-propose-success", 15000);
    const c = await pendingIdByReason(P.admin, reasonC);
    await open(P.finance, "bizsettings-table");
    await present(P.finance, `bizsettings-pending-${c}`);
    await uiClick(P.finance, `bizsetting-approve-run-${c}`);
    check(`${run}.finance.ui-same-day-shows-the-conflict`, (await present(P.finance, `bizsetting-approve-error-${c}`, 15000)) && (await proposalRow(c)).startsWith("pending"), (await textOf(P.finance, `bizsetting-approve-error-${c}`)).slice(0, 100));
    await open(P.admin, "bizsettings-table");
    await present(P.admin, `bizsetting-withdraw-run-${c}`);
    await uiClick(P.admin, `bizsetting-withdraw-run-${c}`);
    check(`${run}.admin.ui-withdraw`, (await present(P.admin, `bizsetting-decided-${c}`, 15000)) && (await proposalRow(c)).startsWith("withdrawn"), await proposalRow(c));

    // 9. Reject with a note in the screen; the whole-number setting proposed in the screen.
    const dw = await nextDate(WHOLE_KEY);
    const reasonW = `w-${tag}`;
    await uiClick(P.admin, `bizsetting-propose-${WHOLE_KEY}`);
    await P.admin.waitFor(`document.querySelector('[data-testid="bizsetting-unit"]')?.textContent === ${JSON.stringify(whole.unit)}`, 10000);
    await fillAndPropose(P.admin, { value: whole.max, from: dw, source: "Live check", reason: reasonW });
    check(`${run}.admin.ui-propose-whole-number`, await present(P.admin, "bizsetting-propose-success", 15000), (await textOf(P.admin, "bizsetting-propose-success")).slice(0, 100));
    const w = await pendingIdByReason(P.admin, reasonW);
    await open(P.finance, "bizsettings-table");
    await present(P.finance, `bizsetting-reject-run-${w}`);
    await setInput(P.finance, `bizsetting-note-${w}`, `no-${tag}`);
    await uiClick(P.finance, `bizsetting-reject-run-${w}`);
    check(`${run}.finance.ui-reject-with-note`, (await present(P.finance, `bizsetting-decided-${w}`, 15000)) && (await proposalRow(w)) === `rejected|false|no-${tag}`, await proposalRow(w));
    await present(P.finance, `bizsettings-decided-${w}`, 15000);
    check(`${run}.finance.ui-lists-it-under-recently-decided`, (await textOf(P.finance, `bizsettings-decided-${w}`)).includes(`rejected`) && (await textOf(P.finance, `bizsettings-decided-${w}`)).includes(`no-${tag}`), (await textOf(P.finance, `bizsettings-decided-${w}`)).slice(0, 100));

    // 10. The permission follows the role it is granted to: the entry, the read and the decision all go.
    const m = await api(P.admin, "POST", PATHS.propose, { settingKey: DEC_KEY, value: "8.00", effectiveFrom: await addDays(d1, 30), sourceReference: "Live check", reason: `m-${tag}` }, key());
    sqlMaint(`DELETE FROM app.capability_grant WHERE capability = 'business_setting_manage' AND role = 'finance'`);
    const goneMenu = await menuOf(P.finance);
    check(`${run}.menu.finance-loses-the-entry-once-removed`, !goneMenu.includes("business-settings"), goneMenu.join(","));
    await open(P.finance, "bizsettings-error");
    check(`${run}.finance.screen-refuses-once-removed`, !(await exists(P.finance, "bizsettings-table")), (await textOf(P.finance, "bizsettings-error")).slice(0, 90));
    r = await api(P.finance, "POST", PATHS.decide(m.body.id), { decision: "approve" }, key());
    check(`${run}.finance.decision-refused-once-removed`, r.status === 403 && r.body?.error === "role_not_permitted", `${r.status} ${r.body?.error}`);
    await api(P.admin, "POST", PATHS.decide(m.body.id), { decision: "withdraw" }, key());

    // 11. Nothing in force today has moved, and no application, rating or certificate changed.
    check(`${run}.db.values-in-force-today-unchanged`, valuesInForce() === inForceBefore, valuesInForce());
    check(`${run}.db.applications-ratings-certificates-unchanged`, before === baseline(), "counts equal");
  } finally {
    sqlMaint(`DELETE FROM app.business_setting_proposal WHERE proposed_by IN (${twinIds}); DELETE FROM app.capability_grant WHERE capability = 'business_setting_manage' AND role = 'finance'`);
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
    await runChecks("settingsui.run1", P);
    await runChecks("settingsui.run2", P);
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("settingsui.run", false, String(e.message)))
  .then(() => {
    console.log(`business-settings-ui checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
