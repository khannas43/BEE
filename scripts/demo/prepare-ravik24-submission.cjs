#!/usr/bin/env node
/* eslint-disable */
/**
 * Prepares the demonstration: signs in as ravik24 and fills and submits the company registration, leaving it in BEE Officer
 * approval, ready for the live approval. Run on a freshly reset demo (npm run demo:prepare-approval does both).
 *   node scripts/demo/prepare-ravik24-submission.cjs
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

const LEGAL = "Ravik Appliances Pvt Ltd";
// Fixed values for the demonstration registration (valid formats; unique on a freshly reset database).
function nextIdentifiers() {
  return { cin: "U27100DL2015PTC123456", gstin: "07AABCR1234A1Z5" };
}
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
    const val = key === "line1" ? "12 Okhla Industrial Area" : key === "city" ? "New Delhi" : key === "state" ? "Delhi" : key === "pincode" ? "110001" : "";
    await setReactField(page, `field-address-${key}`, val);
  }

  await clickStep(page, "contacts");
  await setReactField(page, "field-signatory-name", "Ravi Kumar");
  await setReactField(page, "field-signatory-email", "ravik24@example.invalid");
  await setReactField(page, "field-signatory-phone", "9876543210");
  await setReactField(page, "field-signatory-role", "Director");

  await page.eval(`document.querySelector('[data-testid=wizard-save]').click(); true`);
  await page.waitFor(`(document.body.textContent || '').includes('Progress saved')`, 30000);

  const appId = await resolveAppId(page);
  await patchDraftViaBff(page, appId, {
    cin: CIN,
    gstin: GSTIN,
    registeredAddress: { line1: "12 Okhla Industrial Area", line2: "", city: "Delhi", state: "DL", pincode: "110001" },
    facilities: [{ name: "Okhla Plant 1", addressLine: "12 Okhla Industrial Area", city: "Delhi", state: "DL", pincode: "110001" }],
    authorisedSignatory: {
      name: "Ravi Kumar", email: "ravik24@example.invalid", phone: "9876543210", designation: "Director",
      pan: "ABCDE1234F", aadhaar: "123412341234", fatherName: "R. Kumar", din: "01234567",
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


async function main() {
  const chrome = await launchChrome();
  try {
    const page = await openPage(chrome.cdp);
    await demoSignIn(page, "ravik24");
    const run = await fillWizardCore(page, "ravik24");
    check("prepare.ravik24.submitted", run.detail.state === "director_review", `${run.detail.reference} ${run.detail.state}`);
    console.log(`\nReady: ${run.detail.reference} is waiting for BEE Officer approval (sign in as bee.officer).`);
  } finally {
    await chrome.close();
  }
}

main().catch((e) => {
  console.error(`FAIL prepare.run ${e.message}`);
  process.exit(1);
});
