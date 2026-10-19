#!/usr/bin/env node
/* eslint-disable */
/**
 * Brief C1A: live manufacturer onboarding acceptance through the portal (demo sign-in, real BFF).
 *   node scripts/demo/c1-manufacturer-onboarding-journey.cjs
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

const LEGAL = "Aarav Appliances Pvt Ltd — Demo";
const CIN = "U12345AB6789XYZ123456";
const GSTIN = "22AAAAA0000A1Z5";

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
    const s = Object.getOwnPropertyDescriptor(window.${kind}.prototype, 'value').set;
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
  await page.goto(`${WEB}/app/manufacturer/onboarding`);
  await page.waitFor(`!!document.querySelector('[data-testid=field-legal-name]')`, 60000);

  await setReactField(page, "field-legal-name", LEGAL);
  await setReactField(page, "field-cin", CIN);
  await setReactField(page, "field-gstin", GSTIN);

  await clickStep(page, "address");
  for (const key of ["line1", "line2", "city", "state", "pincode"]) {
    const val = key === "line1" ? "1 Industrial Area" : key === "city" ? "Delhi" : key === "state" ? "DL" : key === "pincode" ? "110001" : "";
    await setReactField(page, `field-address-${key}`, val);
  }

  await clickStep(page, "contacts");
  await setReactField(page, "field-signatory-name", "A. Signatory");
  await setReactField(page, "field-signatory-email", "signatory@demo.invalid");
  await setReactField(page, "field-signatory-phone", "9876543210");
  await setReactField(page, "field-signatory-role", "Director");

  await page.eval(`document.querySelector('[data-testid=wizard-save]').click(); true`);
  await page.waitFor(`(document.body.textContent || '').includes('Progress saved')`, 30000);

  const appId = await resolveAppId(page);
  await patchDraftViaBff(page, appId, {
    cin: CIN,
    gstin: GSTIN,
    registeredAddress: { line1: "1 Industrial Area", line2: "", city: "Delhi", state: "DL", pincode: "110001" },
    facilities: [{ name: "Demo Plant 1", addressLine: "Sector 5, Delhi", city: "Delhi", state: "DL", pincode: "110001" }],
    authorisedSignatory: { name: "A. Signatory", email: "signatory@demo.invalid", phone: "9876543210", designation: "Director" },
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
    email: `wp3d1.${tag}.${stamp}@example.invalid`.toLowerCase(),
    mobile: `9${stamp}0`.slice(0, 10),
    password: "SecurePass1",
  };
}

async function guestRegister(page, creds) {
  await page.goto(`${WEB}/register/manufacturer`);
  if (!(await waitTestId(page, "manufacturer-account-form", 60000))) throw new Error("registration form missing");
  await setReactField(page, "manufacturer-full-name", creds.fullName);
  await setReactField(page, "manufacturer-email", creds.email);
  await setReactField(page, "manufacturer-mobile", creds.mobile);
  await setReactField(page, "manufacturer-password", creds.password);
  await setReactField(page, "manufacturer-confirm-password", creds.password);
  await page.eval(`document.querySelector('[data-testid=create-demo-applicant]').click(); true`);
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

async function financeRaiseAnomaly(page, appId, reference) {
  await openMonitoringItem(page, reference);
  await setTextarea(page, "anomaly-summary", "Synthetic ledger mismatch (C1A demo)");
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
    check("c1.ngrok.url", false, "missing .local/run/ngrok.url");
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

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.log("FAIL c1.chrome", `Chrome not found (${CHROME})`);
    process.exit(1);
  }
  cleanOnboardSynthetic();
  fs.mkdirSync(RUN_DIR, { recursive: true });
  if (!fs.existsSync(PDF)) {
    fs.writeFileSync(PDF, Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"));
  }

  const chrome = await launchChrome();
  try {
    const applicant = await openPage(chrome.cdp);
    const guestA = guestCredentials("activate");
    check("c1.applicant.guest-signup", await guestRegister(applicant, guestA), guestA.email);
    const activationRun = await fillWizardCore(applicant, "director-review");
    check("c1.applicant.director-review", activationRun.detail.state === "director_review", activationRun.detail.reference);
    evidence.applications.directorReview = {
      id: activationRun.appId,
      reference: activationRun.detail.reference,
      version: activationRun.detail.version,
      state: activationRun.detail.state,
    };
    await applicant.close();
    const dirActivate = await openPage(chrome.cdp);
    await demoSignIn(dirActivate, "bee.director");
    const activated = await directorApprove(dirActivate, activationRun.appId, activationRun.detail.reference);
    check("c1.director.approve-activation", activated.state === "active_observation", activated.reference);
    await dirActivate.close();

    const applicantRevoke = await openPage(chrome.cdp);
    const guestR = guestCredentials("revoke");
    await guestRegister(applicantRevoke, guestR);
    const revokeRun = await fillWizardCore(applicantRevoke, "revoke");
    check("c1.applicant.submit-revoke", revokeRun.detail.state === "director_review", revokeRun.detail.reference);
    await applicantRevoke.close();
    const dirRevokeReady = await openPage(chrome.cdp);
    await demoSignIn(dirRevokeReady, "bee.director");
    await directorApprove(dirRevokeReady, revokeRun.appId, revokeRun.detail.reference);
    await dirRevokeReady.close();
    const finRevoke = await openPage(chrome.cdp);
    await demoSignIn(finRevoke, "bee.finance");
    const held = await financeRaiseAnomaly(finRevoke, revokeRun.appId, revokeRun.detail.reference);
    check("c1.finance.anomaly-before-revoke", held.state === "on_hold", held.state);
    await finRevoke.close();
    const dirRevoke2 = await openPage(chrome.cdp);
    await demoSignIn(dirRevoke2, "bee.officer");
    const revoked = await directorRevokeAfterHold(dirRevoke2, revokeRun.appId, revokeRun.detail.reference);
    check("c1.director.revoke-disposable", revoked.state === "revoked", revoked.reference);
    evidence.applications.revoke = {
      id: revokeRun.appId,
      reference: revokeRun.detail.reference,
      state: revoked.state,
    };
    await dirRevoke2.close();

    const applicantMain = await openPage(chrome.cdp);
    const guestM = guestCredentials("primary");
    await guestRegister(applicantMain, guestM);
    const mainRun = await fillWizardCore(applicantMain, "primary");
    const appMeta = mainRun.detail;
    const feeInr = appMeta.fee?.amountInr;
    const paymentStatus = appMeta.payment?.status;
    const receipt = appMeta.payment?.receiptNumber;
    check(
      "c1.applicant.submit-director-review",
      appMeta.state === "director_review" && paymentStatus === "paid" && feeInr === "5000.00" && !!receipt && !appMeta.permitteeNumber,
      `${appMeta.reference} state=${appMeta.state} fee=${feeInr} payment=${paymentStatus} receipt=${receipt}`,
    );
    evidence.applications.primary = {
      id: appMeta.id,
      reference: appMeta.reference,
      version: appMeta.version,
      state: appMeta.state,
      documentKinds: DOC_KINDS,
      feeAmountInr: feeInr,
      paymentStatus,
      paymentReceipt: receipt,
      automatedChecks: appMeta.automatedChecks || [],
    };
    await applicantMain.close();

    const director = await openPage(chrome.cdp);
    check("c1.director.sign-in", await demoSignIn(director, "bee.officer"), "officer demo sign-in");
    const approvedMain = await directorApprove(director, appMeta.id, appMeta.reference);
    check("c1.director.pending-queue", approvedMain.state === "active_observation", approvedMain.reference);
    const afterActivate = await fetchStrict(director, `/api/runtime/manufacturer-onboarding/${encodeURIComponent(appMeta.id)}`, { method: "GET" });
    const obs = observationDays(appMeta.id);
    const permittee = afterActivate.permitteeNumber || afterActivate.permitteeActivation?.permitteeNumber;
    check(
      "c1.system.activate-observation",
      afterActivate.state === "active_observation" && !!permittee && obs.daysApart === 15,
      `permittee=${permittee} obs ${obs.started}→${obs.ends} (${obs.daysApart}d)`,
    );
    check(
      "c1.no-observation-close-ui",
      !(await director.eval(`!!document.querySelector('[data-testid*=observation-close]')`)),
      "no browser observation-close control",
    );
    evidence.applications.primary.permitteeNumber = permittee;
    evidence.applications.primary.observation = obs;
    await director.close();

    const finance = await openPage(chrome.cdp);
    check("c1.finance.sign-in", await demoSignIn(finance, "bee.finance"), "finance demo sign-in");
    const onHold = await financeRaiseAnomaly(finance, appMeta.id, appMeta.reference);
    check("c1.finance.anomaly-hold", onHold.state === "on_hold", `state=${onHold.state}`);
    check(
      "c1.finance.cannot-resolve",
      !(await finance.eval(`!!document.querySelector('[data-testid=director-resolve]')`)),
      "finance sees no resolve button",
    );
    evidence.applications.primary.anomaly = { actor: "bee.finance", holdState: onHold.state };
    await finance.close();

    const director2 = await openPage(chrome.cdp);
    await demoSignIn(director2, "bee.officer");
    const resolved = await directorResolveHold(director2, appMeta.id, appMeta.reference);
    check("c1.director.resolve-hold", resolved.state === "active_observation", `state=${resolved.state}`);
    evidence.applications.primary.anomaly.directorResolveState = resolved.state;
    await director2.close();

    evidence.ngrokUrl = await verifyNgrokRoutes();
    fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2));
    check("c1.evidence-written", fs.existsSync(EVIDENCE), EVIDENCE);
  } finally {
    await chrome.close();
  }
  console.log(`c1 journey: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.log("FAIL c1.run", e.message);
  try {
    fs.mkdirSync(RUN_DIR, { recursive: true });
    evidence.failure = e.message;
    fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2));
  } catch {}
  process.exit(1);
});
