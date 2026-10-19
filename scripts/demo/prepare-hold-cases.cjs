#!/usr/bin/env node
/* eslint-disable */
/**
 * Prepares three registrations through the real screens: sign-up, wizard, BEE Officer approval, and for two of them Finance then
 * raises an anomaly (ON HOLD). The third is left under normal observation. ONLY=<username> prepares just that one. Run on a freshly reset demo after prepare-ravik24-submission.cjs (npm run demo:prepare-approval does all).
 *   node scripts/demo/prepare-hold-cases.cjs
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { WEB, PASSWORD: _p, CHROME, launchChrome } = require("../local/browser-check.cjs");

const DEMO_PASS = process.env.BEE_DEMO_PASSWORD || "demo123";
const RUN_DIR = path.join(__dirname, "../../.local/run");
const PDF = path.join(RUN_DIR, "mob-demo.pdf");
const EVIDENCE = path.join(RUN_DIR, "c1-journey-evidence.json");
const ONBOARD_ORG = "00000000-0000-4000-b000-000000000007";

const DOC_KINDS = [
  "trade_licence",
  "certificate_of_incorporation",
  "gst_certificate",
  "pan_card",
  "signatory_photo_id",
  "facility_address_proof",
  "signed_declaration",
  "signed_agreement",
];

let LEGAL = "";
function nextIdentifiers() {
  return { cin: CASE_CIN, gstin: CASE_GSTIN };
}
let CASE_CIN = "";
let CASE_ADDRESS = "";
let CASE_SIGNATORY = "";
let CASE_EMAIL = "";
let CASE_PLANT = "";
let CASE_STATE = "Delhi";
let CASE_CITY = "New Delhi";
let CASE_GSTIN = "";
let CIN = "";
let GSTIN = "";

let pass = 0;
let fail = 0;
const evidence = { at: new Date().toISOString(), web: WEB, steps: {}, applications: {} };

function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(52)} ${detail}`);
  evidence.steps[id] = { result: r, detail };
  if (!ok) throw new Error(`${id}: ${detail}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(cdp) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = {
    sessionId,
    cdp,
    eval: async (expression) => {
      const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    goto: (url) => cdp.send("Page.navigate", { url }, sessionId),
    waitFor: async (expression, timeoutMs = 90000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        try {
          if (await page.eval(expression)) return true;
        } catch {}
        await sleep(250);
      }
      return false;
    },
    setFiles: async (testId, filePath) => {
      const { root } = await cdp.send("DOM.getDocument", {}, sessionId);
      const { nodeId } = await cdp.send(
        "DOM.querySelector",
        { nodeId: root.nodeId, selector: `[data-testid="${testId}"]` },
        sessionId,
      );
      await cdp.send("DOM.setFileInputFiles", { nodeId, files: [filePath] }, sessionId);
      await page.eval(
        `(() => { const el = document.querySelector('[data-testid=${JSON.stringify(testId)}]'); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
      );
    },
    close: () => cdp.send("Target.disposeBrowserContext", { browserContextId }),
  };
  await cdp.send("Page.enable", {}, sessionId);
  return page;
}

async function demoSignIn(page, username) {
  await page.goto(`${WEB}/login`);
  const body = await page.eval(`fetch('/api/runtime/demo/login', {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ${JSON.stringify(username)}, password: ${JSON.stringify(DEMO_PASS)} }),
  }).then(async (r) => ({ status: r.status, ok: r.ok, ...(await r.json().catch(() => ({}))) }))`);
  if (!body.ok) throw new Error(`demo login failed (${body.status}): ${JSON.stringify(body)}`);
  await page.goto(`${WEB}${body.returnTo || "/app"}`);
  const ok = await page.waitFor(`!!document.querySelector('[data-testid=session-badge]')`, 60000);
  if (!ok) throw new Error("session badge missing after demo sign-in");
  return true;
}

function psql(q) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      "PGPASSWORD=bee-local-app",
      "bee-local-postgres",
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "bee_app",
      "-d",
      "bee_app",
      "-v",
      "ON_ERROR_STOP=1",
      "-qtA",
      "-c",
      q,
    ],
    { encoding: "utf8" },
  ).trim();
}

function cleanOnboardSynthetic() {
  psql(
    `UPDATE app.manufacturer_onboarding_application SET state = 'revoked' WHERE organisation_id = '${ONBOARD_ORG}' AND state NOT IN ('rejected', 'revoked')`,
  );
  psql(`UPDATE app.organisation SET permittee_lifecycle = 'none' WHERE id = '${ONBOARD_ORG}'`);
}

async function waitTestId(page, testId, timeoutMs = 60000) {
  return page.waitFor(
    `((tid) => !!document.querySelector('[data-testid="' + tid + '"]'))(${JSON.stringify(testId)})`,
    timeoutMs,
  );
}

async function clickTestId(page, testId) {
  await page.eval(`((tid) => {
    const el = document.querySelector('[data-testid="' + tid + '"]');
    if (!el) throw new Error('missing test id ' + tid);
    el.click();
    return true;
  })(${JSON.stringify(testId)})`);
}

async function setReactField(page, testId, value, kind = "HTMLInputElement") {
  await page.eval(`(() => {
    const el = document.querySelector('[data-testid=${JSON.stringify(testId)}]');
    if (!el) throw new Error('missing ' + ${JSON.stringify(testId)});
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement : ${kind === 'HTMLTextAreaElement' ? 'window.HTMLTextAreaElement' : 'window.HTMLInputElement'};
    const s = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set;
    s.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function waitEnabled(page, testId, timeoutMs = 60000) {
  const ok = await page.waitFor(
    `(() => { const b = document.querySelector('[data-testid=${JSON.stringify(testId)}]'); return !!b && !b.disabled; })()`,
    timeoutMs,
  );
  if (!ok) throw new Error(`button ${testId} did not become enabled`);
}

async function pollApplication(page, appId, predicate, label, timeoutMs = 90000) {
  const url = `/api/runtime/manufacturer-onboarding/${encodeURIComponent(appId)}`;
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    last = await fetchStrict(page, url, { method: "GET" });
    if (predicate(last)) return last;
    await sleep(500);
  }
  throw new Error(`${label}: timed out (last state=${last?.state ?? "?"})`);
}

async function fetchStrict(page, url, init = {}) {
  const raw = await page.eval(`(async () => {
    const init = ${JSON.stringify(init)};
    const r = await fetch(${JSON.stringify(url)}, { credentials: 'include', cache: 'no-store', ...init });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { _raw: text }; }
    return JSON.stringify({ status: r.status, ok: r.ok, body });
  })()`);
  const parsed = JSON.parse(raw);
  if (!parsed.ok) {
    throw new Error(`HTTP ${parsed.status} ${url}: ${JSON.stringify(parsed.body)}`);
  }
  return parsed.body;
}

async function clickStep(page, stepId) {
  await page.eval(`document.querySelector('[data-testid="step-${stepId}"]').click(); true`);
  await sleep(200);
}

async function resolveAppId(page) {
  const list = await fetchStrict(page, "/api/runtime/manufacturer-onboarding", { method: "GET" });
  const item =
    (list.items || []).find((x) => x.state === "draft" || x.state === "automatic_checks_failed") || (list.items || [])[0];
  if (!item?.id) throw new Error("no manufacturer onboarding application");
  return item.id;
}

async function patchDraftViaBff(page, appId, draftBody) {
  const detail = await fetchStrict(page, `/api/runtime/manufacturer-onboarding/${encodeURIComponent(appId)}`, { method: "GET" });
  const { randomUUID } = require("crypto");
  return fetchStrict(page, `/api/runtime/manufacturer-onboarding/${encodeURIComponent(appId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID().replace(/-/g, "").slice(0, 24) },
    body: JSON.stringify({ version: detail.version, legalName: LEGAL, draft: draftBody }),
  });
}

async function fillWizardCore(page, tag) {
  ({ cin: CIN, gstin: GSTIN } = nextIdentifiers());
  await page.goto(`${WEB}/app/manufacturer/onboarding`);
  await page.waitFor(`!!document.querySelector('[data-testid=field-legal-name]')`, 60000);

  await setReactField(page, "field-legal-name", LEGAL);
  await setReactField(page, "field-cin", CIN);
  await setReactField(page, "field-gstin", GSTIN);

  await clickStep(page, "company");
  for (const key of ["line1", "line2", "state", "city", "pincode"]) {
    const val = key === "line1" ? CASE_ADDRESS : key === "city" ? CASE_CITY : key === "state" ? CASE_STATE : key === "pincode" ? "110001" : "";
    await setReactField(page, `field-address-${key}`, val);
  }

  await clickStep(page, "contacts");
  await setReactField(page, "field-signatory-name", CASE_SIGNATORY);
  await setReactField(page, "field-signatory-email", CASE_EMAIL);
  await setReactField(page, "field-signatory-phone", "9876543210");
  await setReactField(page, "field-signatory-role", "Director");

  await page.eval(`document.querySelector('[data-testid=wizard-save]').click(); true`);
  await page.waitFor(`(document.body.textContent || '').includes('Progress saved')`, 30000);

  const appId = await resolveAppId(page);
  await patchDraftViaBff(page, appId, {
    cin: CIN,
    gstin: GSTIN,
    registeredAddress: { line1: CASE_ADDRESS, line2: "", city: CASE_CITY, state: CASE_STATE, pincode: "110001" },
    facilities: [{ name: CASE_PLANT, addressLine: CASE_ADDRESS, city: CASE_CITY, state: CASE_STATE, pincode: "110001" }],
    authorisedSignatory: {
      name: CASE_SIGNATORY, email: CASE_EMAIL, phone: "9876543210", designation: "Director",
      pan: "ABCDE1234F", aadhaar: "123412341234", fatherName: "R. Signatory", din: "01234567",
      residentialAddress: { line1: "5 Residency Road", line2: "", city: "New Delhi", state: "Delhi", pincode: "110001" },
    },
    contacts: [],
    declarationAccepted: false,
    agreementAccepted: false,
  });
  await page.goto(`${WEB}/app/manufacturer/onboarding`);
  await page.waitFor(`!!document.querySelector('[data-testid=onboarding-stepper]')`, 60000);

  await clickStep(page, "annexure");
  for (const kind of DOC_KINDS) {
    await page.setFiles(`upload-${kind}`, PDF);
    const uploaded = await page.waitFor(
      `(() => { const el = document.querySelector('[data-testid="upload-status-${kind}"]'); return el && el.textContent.includes('Uploaded'); })()`,
      120000,
    );
    if (!uploaded) throw new Error(`${tag}: upload UI did not confirm ${kind}`);
  }

  await page.goto(`${WEB}/app/manufacturer/onboarding`);
  await page.waitFor(`!!document.querySelector('[data-testid=onboarding-stepper]')`, 60000);
  await clickStep(page, "annexure");
  for (const kind of DOC_KINDS) {
    const ok = await page.eval(
      `(() => { const el = document.querySelector('[data-testid="upload-status-${kind}"]'); return el && el.textContent.includes('Uploaded'); })()`,
    );
    if (!ok) throw new Error(`${tag}: ${kind} missing after reload`);
  }

  const detail = await fetchStrict(page, `/api/runtime/manufacturer-onboarding/${encodeURIComponent(appId)}`, { method: "GET" });
  const kindsPresent = new Set((detail.documents || []).filter((d) => d.status === "uploaded").map((d) => d.documentKind));
  for (const kind of DOC_KINDS) {
    if (!kindsPresent.has(kind)) throw new Error(`${tag}: BFF detail missing uploaded ${kind}`);
  }

  await clickStep(page, "declaration");
  await page.eval(`(() => { document.querySelector('[data-testid=checkbox-declaration]').click(); document.querySelector('[data-testid=checkbox-agreement]').click(); return true; })()`);

  await clickStep(page, "review");
  await waitEnabled(page, "wizard-submit", 120000);
  await page.eval(`document.querySelector('[data-testid=wizard-submit]').click(); true`);
  const navigated = await page.waitFor(`location.pathname.startsWith('/app/manufacturer/application/')`, 120000);
  if (!navigated) throw new Error(`${tag}: submit did not navigate to application lifecycle`);

  const after = await fetchStrict(page, `/api/runtime/manufacturer-onboarding/${encodeURIComponent(appId)}`, { method: "GET" });
  return { appId, detail: after };
}

async function setTextarea(page, testId, value) {
  await setReactField(page, testId, value, "HTMLTextAreaElement");
}

async function openDirectorQueueItem(page, reference) {
  await page.goto(`${WEB}/app/manufacturer/director`);
  const itemId = `director-item-${reference}`;
  if (!(await waitTestId(page, itemId, 120000))) throw new Error(`director queue missing ${itemId}`);
  await clickTestId(page, itemId);
  await page.waitFor(
    `!!document.querySelector('[data-testid=director-reject-open]') || !!document.querySelector('[data-testid=director-approve]')`,
    60000,
  );
}

async function directorRejectDisposable(page, appId, reference) {
  await openDirectorQueueItem(page, reference);
  await setTextarea(page, "director-decision-note", "Incomplete demo dossier (disposable WP3-D1)");
  await page.eval(`document.querySelector('[data-testid=director-reject-open]').click(); true`);
  await page.waitFor(`(document.body.textContent || '').toLowerCase().includes('rejected')`, 60000);
  return pollApplication(page, appId, (d) => d.state === "rejected", "director reject");
}

async function directorApprove(page, appId, reference) {
  await openDirectorQueueItem(page, reference);
  await setTextarea(page, "director-decision-note", "Director activates manufacturer for observation");
  await page.eval(`document.querySelector('[data-testid=director-approve]').click(); true`);
  await page.waitFor(`(document.body.textContent || '').toLowerCase().includes('observation')`, 60000);
  return pollApplication(page, appId, (d) => d.state === "active_observation", "director approve");
}

function guestCredentials(tag) {
  const stamp = `${Date.now()}`.slice(-8);
  return {
    fullName: `WP3 D1 ${tag}`,
    username: `wp3d1.${tag}.${stamp}`.toLowerCase(),
    email: `wp3d1.${tag}.${stamp}@example.invalid`.toLowerCase(),
    mobile: `9${stamp}0`.slice(0, 10),
    password: "SecurePass1",
  };
}

async function guestRegister(page, creds) {
  await page.goto(`${WEB}/register/manufacturer`);
  if (!(await waitTestId(page, "manufacturer-account-form", 60000))) throw new Error("registration form missing");
  await sleep(2500); // let the form hydrate before typing, or a click submits it natively and clears it
  await setReactField(page, "manufacturer-legal-name", creds.legalName || LEGAL);
  await setReactField(page, "manufacturer-full-name", creds.fullName);
  await setReactField(page, "manufacturer-email", creds.email);
  await setReactField(page, "manufacturer-mobile", creds.mobile);
  await setReactField(page, "manufacturer-username", creds.username);
  await setReactField(page, "manufacturer-password", creds.password);
  await setReactField(page, "manufacturer-confirm-password", creds.password);
  await page.eval(`document.querySelector('[data-testid=manufacturer-account-form] button[type=submit]').click(); true`);
  // The simulated e-mail acknowledgement page comes first; its button continues to the application.
  if (!(await waitTestId(page, "continue-manufacturer-application", 120000))) throw new Error("signup confirmation did not appear: " + (await page.eval(`JSON.stringify([...document.querySelectorAll('[data-testid=manufacturer-account-form] input')].map(i=>i.id+'='+i.value.slice(0,12)).concat([String(document.querySelector('[data-testid=manufacturer-account-form] button[type=submit]').disabled)]))`)));
  await page.eval(`document.querySelector('[data-testid=continue-manufacturer-application]').click(); true`);
  const ok = await page.waitFor(`location.pathname.startsWith('/app/manufacturer/onboarding')`, 120000);
  if (!ok) throw new Error("guest signup did not open onboarding");
  return true;
}

async function openMonitoringItem(page, reference) {
  await page.goto(`${WEB}/app/manufacturer/monitoring`);
  const itemId = `monitoring-item-${reference}`;
  if (!(await waitTestId(page, itemId, 120000))) throw new Error(`monitoring queue missing ${itemId}`);
  await clickTestId(page, itemId);
  await page.waitFor(`!!document.querySelector('[data-testid=raise-anomaly-submit], [data-testid=director-resolve], [data-testid=director-revoke]')`, 60000);
}

async function financeRaiseAnomaly(page, appId, reference, reason) {
  await openMonitoringItem(page, reference);
  await setTextarea(page, "anomaly-summary", reason);
  await waitEnabled(page, "raise-anomaly-submit");
  await page.eval(`document.querySelector('[data-testid=raise-anomaly-submit]').click(); true`);
  await page.waitFor(`(document.body.textContent || '').toLowerCase().includes('hold')`, 60000);
  return pollApplication(page, appId, (d) => d.state === "on_hold", "finance anomaly");
}

async function directorResolveHold(page, appId, reference) {
  await openMonitoringItem(page, reference);
  await setTextarea(page, "director-hold-note", "Cleared after review (C1A)");
  await waitEnabled(page, "director-resolve");
  await page.eval(`document.querySelector('[data-testid=director-resolve]').click(); true`);
  await page.waitFor(`(document.body.textContent || '').toLowerCase().includes('active observation')`, 60000);
  return pollApplication(page, appId, (d) => d.state === "active_observation", "director resolve");
}

async function directorRevokeAfterHold(page, appId, reference) {
  await openMonitoringItem(page, reference);
  await setTextarea(page, "director-hold-note", "Revoked for C1A disposable demo");
  await waitEnabled(page, "director-revoke");
  await page.eval(`document.querySelector('[data-testid=director-revoke]').click(); true`);
  await page.waitFor(`(document.body.textContent || '').toLowerCase().includes('revoked')`, 60000);
  return pollApplication(page, appId, (d) => d.state === "revoked", "director revoke");
}

function observationDays(appId) {
  const obs = psql(
    `SELECT started_on::text, ends_on::text FROM app.manufacturer_onboarding_observation WHERE application_id = '${appId}'`,
  );
  const [started, ends] = obs.split("|");
  const daysApart =
    started && ends ? Math.round((Date.parse(ends) - Date.parse(started)) / 86400000) : -1;
  return { started, ends, daysApart };
}

async function verifyNgrokRoutes() {
  const ngrokPath = path.join(RUN_DIR, "ngrok.url");
  const base = fs.existsSync(ngrokPath) ? fs.readFileSync(ngrokPath, "utf8").trim() : "";
  if (!base) {
    console.log("SKIP c1.ngrok.url                                      no tunnel configured (laptop-only demonstration)");
    return "";
  }
  const paths = [
    "/",
    "/login",
    "/register/manufacturer",
    "/app/manufacturer/onboarding",
    "/app/manufacturer/director",
    "/app/manufacturer/monitoring",
    "/app/demo/manufacturer-360",
    "/verify?reg=BEE/RAC/2026/10101",
  ];
  for (const p of paths) {
    const r = await fetch(`${base}${p}`, { redirect: "manual", headers: { "ngrok-skip-browser-warning": "1" } });
    const loc = r.headers.get("location") || "";
    const badRedirect = /localhost|127\.0\.0\.1|:8180/.test(loc);
    check(`c1.ngrok${p.split("?")[0]}`, r.status >= 200 && r.status < 400 && !badRedirect, `${r.status} loc=${loc || "—"}`);
  }
  return base;
}


const CASES = [
  {
    legal: "Kestrel Cooling Systems Pvt Ltd", username: "kestrel.mfg", email: "accounts@kestrelcooling.example", mobile: "9822011144", person: "Sunil Patwardhan",
    cin: "U29190MH2021PTC356712", gstin: "27AAECK4471J1ZB", address: "Gat 412, Hinjewadi Phase 3", plant: "Hinjewadi Plant", state: "Maharashtra", city: "Pune",
    reason: "GSTIN mismatch found on the first supplier invoice batch: invoices INV-2026-0917 to 0921 carry GSTIN 27AAECK4471J2ZA, which differs from the registered GSTIN 27AAECK4471J1ZB. Registration placed on hold until the applicant explains the second GSTIN and supplies its certificate.",
  },
  {
    legal: "Brightwave Appliances Pvt Ltd", username: "brightwave.mfg", email: "finance@brightwave.example", mobile: "9879033021", person: "Nisha Doshi",
    cin: "U29300GJ2018PTC104377", gstin: "24AAFCB2290M1ZR", address: "Plot 63, GIDC Sachin", plant: "Sachin Plant", state: "Gujarat", city: "Surat",
    reason: "Registration fee payment reversed after activation: the gateway reports receipt SIMRCPT-REV-0412 as charged back, so the Rs 5,000 fee is no longer verified. Hold applied until Finance confirms a fresh payment or the reversal is withdrawn.",
  },
  {
    legal: "Zephyr Climate Appliances Pvt Ltd", username: "zephyr.mfg", email: "admin@zephyrclimate.example", mobile: "9890044512", person: "Aditya Joshi",
    cin: "U29190MH2022PTC391045", gstin: "27AAGCZ6638Q1ZH", address: "Plot 21, MIDC Butibori", plant: "Butibori Plant", state: "Maharashtra", city: "Nagpur",
    reason: null,
  },
];

async function main() {
  const chrome = await launchChrome();
  try {
    for (const c of CASES.filter((x) => !process.env.ONLY || x.username === process.env.ONLY)) {
      LEGAL = c.legal;
      CASE_CIN = c.cin;
      CASE_GSTIN = c.gstin;
      CASE_ADDRESS = c.address;
      CASE_SIGNATORY = c.person;
      CASE_EMAIL = c.email;
      CASE_PLANT = c.plant;
      CASE_STATE = c.state;
      CASE_CITY = c.city;
      const applicant = await openPage(chrome.cdp);
      await guestRegister(applicant, { legalName: c.legal, fullName: c.person, email: c.email, mobile: c.mobile, username: c.username, password: "demo123" });
      const run = await fillWizardCore(applicant, c.username);
      check(`hold.${c.username}.submitted`, run.detail.state === "director_review", run.detail.reference);
      await applicant.close();
      const officer = await openPage(chrome.cdp);
      await demoSignIn(officer, "bee.officer");
      const activated = await directorApprove(officer, run.appId, run.detail.reference);
      check(`hold.${c.username}.activated`, activated.state === "active_observation", activated.reference);
      await officer.close();
      if (!c.reason) continue; // left under normal observation
      const finance = await openPage(chrome.cdp);
      await demoSignIn(finance, "bee.finance");
      const held = await financeRaiseAnomaly(finance, run.appId, run.detail.reference, c.reason);
      check(`hold.${c.username}.on-hold`, held.state === "on_hold", `${held.reference} ${held.state}`);
      await finance.close();
    }
    console.log("\nReady: two registrations on hold with an anomaly and one under normal observation (BEE Officer: Anomalies and holds).");
  } finally {
    await chrome.close();
  }
}

main().catch((e) => {
  console.error(`FAIL hold.run ${e.message}`);
  process.exit(1);
});
