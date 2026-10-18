#!/usr/bin/env node
/* eslint-disable */
/**
 * Brief C1: live manufacturer onboarding journey through the portal (demo sign-in, real BFF).
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
const evidence = { at: new Date().toISOString(), web: WEB, steps: {} };

function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(48)} ${detail}`);
  evidence.steps[id] = { result: r, detail };
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
  }).then(async (r) => ({ ok: r.ok, ...(await r.json()) }))`);
  if (!body.ok) throw new Error(`demo login failed: ${JSON.stringify(body)}`);
  await page.goto(`${WEB}${body.returnTo || "/app"}`);
  return page.waitFor(`!!document.querySelector('[data-testid=session-badge]')`, 60000);
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

async function seedDraftFields(page) {
  const kinds = JSON.stringify(DOC_KINDS);
  const raw = await page.eval(`(async () => {
    const idem = () => crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    const pdf = new Uint8Array([37,80,68,70,45,49,46,52,10,37,255,255,255,255]);
    const list = await fetch('/api/runtime/manufacturer-onboarding', { credentials: 'include' }).then((r) => r.json());
    let item = (list.items || []).find((x) => x.state === 'draft' || x.state === 'automatic_checks_failed') || (list.items || [])[0];
    if (!item) {
      item = await fetch('/api/runtime/manufacturer-onboarding', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem() },
        body: JSON.stringify({ legalName: ${JSON.stringify(LEGAL)}, draft: {} }),
      }).then((r) => r.json());
    }
    const d = await fetch('/api/runtime/manufacturer-onboarding/' + encodeURIComponent(item.id), { credentials: 'include' }).then((r) => r.json());
    const draft = {
      cin: ${JSON.stringify(CIN)},
      gstin: ${JSON.stringify(GSTIN)},
      declarationAccepted: true,
      agreementAccepted: true,
      registeredAddress: { line1: '1 Industrial Area', line2: '', city: 'Delhi', state: 'DL', pincode: '110001' },
      authorisedSignatory: { name: 'A. Signatory', email: 'signatory@demo.invalid', phone: '9876543210', designation: 'Director' },
      facilities: [{ name: 'Demo Plant 1', addressLine: 'Sector 5, Delhi', city: 'Delhi', state: 'DL', pincode: '110001' }],
      contacts: [],
    };
    const patched = await fetch('/api/runtime/manufacturer-onboarding/' + encodeURIComponent(item.id), {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idem() },
      body: JSON.stringify({ version: d.version, legalName: ${JSON.stringify(LEGAL)}, draft }),
    }).then((r) => r.json());
    let version = patched.version;
    for (const kind of ${kinds}) {
      const fd = new FormData();
      fd.append('file', new File([pdf], kind + '.pdf', { type: 'application/pdf' }));
      fd.append('documentKind', kind);
      fd.append('label', kind);
      const up = await fetch('/api/runtime/manufacturer-onboarding/' + encodeURIComponent(item.id) + '/documents', {
        method: 'POST', credentials: 'include', headers: { 'Idempotency-Key': idem() }, body: fd,
      }).then((r) => r.json());
      version = up.version ?? version;
    }
    return JSON.stringify({ id: item.id, version });
  })()`);
  return JSON.parse(raw);
}

async function fillWizard(page) {
  await page.goto(`${WEB}/app/manufacturer/onboarding`);
  await page.waitFor(`!!document.querySelector('[data-testid=field-legal-name]')`, 60000);
  const seeded = await seedDraftFields(page);
  await page.goto(`${WEB}/app/manufacturer/onboarding`);
  await page.waitFor(`!!document.querySelector('[data-testid=onboarding-stepper]')`, 60000);
  await page.eval(`document.querySelector('[data-testid=wizard-save]').click(); true`);
  await page.waitFor(`(document.body.textContent || '').includes('Progress saved')`, 30000);
  await page.eval(`document.querySelector('[data-testid=step-review]').click(); true`);
  await page.waitFor(`!!document.querySelector('[data-testid=wizard-submit]')`);
  await page.eval(`document.querySelector('[data-testid=wizard-submit]').click(); true`);
  const ok = await page.waitFor(`location.pathname.startsWith('/app/manufacturer/application/')`, 120000);
  return { ok, appId: seeded.id };
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    check("c1.chrome", false, `Chrome not found (${CHROME})`);
    process.exit(1);
  }
  try {
    psql(
      "UPDATE app.manufacturer_onboarding_application SET state = 'revoked' WHERE organisation_id = '00000000-0000-4000-b000-000000000007' AND state NOT IN ('rejected', 'revoked')",
    );
    psql("UPDATE app.organisation SET permittee_lifecycle = 'none' WHERE code = 'ONBOARD'");
  } catch {
    /* postgres optional for local-only run */
  }
  fs.mkdirSync(RUN_DIR, { recursive: true });
  if (!fs.existsSync(PDF)) {
    fs.writeFileSync(PDF, Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"));
  }

  const chrome = await launchChrome();
  try {
    const applicant = await openPage(chrome.cdp);
    check("c1.applicant.sign-in", await demoSignIn(applicant, "onboarding.applicant"), "demo sign-in");

    // Disposable reject first (one live application per org).
    const rejectRun = await fillWizard(applicant);
    check("c1.applicant.wizard-submit-reject", rejectRun.ok, "submitted disposable app");
    const rejectMeta = await applicant.eval(
      `fetch('/api/runtime/manufacturer-onboarding/${rejectRun.appId}', { credentials: 'include' }).then(r => r.json())`,
    );
    await applicant.close();
    const dirReject = await openPage(chrome.cdp);
    check("c1.director.sign-in-reject", await demoSignIn(dirReject, "bee.director"), "director for reject");
    await dirReject.goto(`${WEB}/app/manufacturer/director`);
    await dirReject.waitFor(`!!document.querySelector('[data-testid=director-reject-open]')`, 60000);
    await dirReject.eval(`document.querySelector('[data-testid=director-reject-open]').click(); true`);
    await dirReject.waitFor(`!!document.querySelector('[data-testid=director-reject-reason]')`);
    await dirReject.eval(`document.querySelector('[data-testid=director-reject-reason]').value = 'Incomplete demo dossier (disposable)'; true`);
    await dirReject.eval(`document.querySelector('[data-testid=director-reject-confirm]').click(); true`);
    await dirReject.waitFor(`(document.body.textContent || '').includes('rejected')`, 60000);
    const rejected = await dirReject.eval(
      `fetch('/api/runtime/manufacturer-onboarding/${rejectMeta.id}', { credentials: 'include' }).then(r => r.json())`,
    );
    check("c1.director.reject-disposable", rejected.state === "rejected", `${rejectMeta.reference} → rejected`);
    evidence.rejectApplication = { reference: rejectMeta.reference, state: rejected.state };
    await dirReject.close();

    const applicantRevoke = await openPage(chrome.cdp);
    await demoSignIn(applicantRevoke, "onboarding.applicant");
    const revokeRun = await fillWizard(applicantRevoke);
    check("c1.applicant.wizard-submit-revoke", revokeRun.ok, "submitted revoke disposable");
    const revokeMeta = await applicantRevoke.eval(
      `fetch('/api/runtime/manufacturer-onboarding/${revokeRun.appId}', { credentials: 'include' }).then(r => r.json())`,
    );
    await applicantRevoke.close();
    const dirRevoke = await openPage(chrome.cdp);
    await demoSignIn(dirRevoke, "bee.director");
    await dirRevoke.goto(`${WEB}/app/manufacturer/director`);
    await dirRevoke.waitFor(`!!document.querySelector('[data-testid=director-approve]')`, 60000);
    await dirRevoke.eval(`document.querySelector('[data-testid=director-approve]').click(); true`);
    await dirRevoke.waitFor(`(document.body.textContent || '').includes('approved')`, 60000);
    await dirRevoke.goto(`${WEB}/app/manufacturer/monitoring`);
    await dirRevoke.waitFor(`!!document.querySelector('[data-testid=director-revoke]')`, 60000);
    await dirRevoke.eval(`document.querySelector('[data-testid=director-hold-note]').value = 'Revoked for C1 disposable demo'; true`);
    await dirRevoke.eval(`document.querySelector('[data-testid=director-revoke]').click(); true`);
    await dirRevoke.waitFor(`(document.body.textContent || '').includes('revoked')`, 60000);
    const revoked = await dirRevoke.eval(
      `fetch('/api/runtime/manufacturer-onboarding/${revokeMeta.id}', { credentials: 'include' }).then(r => r.json())`,
    );
    check("c1.director.revoke-disposable", revoked.state === "revoked", `${revokeMeta.reference} → revoked`);
    evidence.revokeApplication = { reference: revokeMeta.reference, state: revoked.state };
    await dirRevoke.close();

    const applicantMain = await openPage(chrome.cdp);
    await demoSignIn(applicantMain, "onboarding.applicant");
    const mainRun = await fillWizard(applicantMain);
    check("c1.applicant.wizard-submit-main", mainRun.ok, "submitted main app");
    const appMeta = await applicantMain.eval(
      `fetch('/api/runtime/manufacturer-onboarding/${mainRun.appId}', { credentials: 'include' }).then(r => r.json())`,
    );
    evidence.primaryApplication = {
      id: appMeta.id,
      reference: appMeta.reference,
      version: appMeta.version,
      phase: appMeta.state,
      fee: appMeta.expectedFee?.amountInr,
      paymentReceipt: appMeta.payment?.receiptNumber,
    };
    check(
      "c1.applicant.director-review",
      appMeta.state === "director_review" && appMeta.payment?.status === "verified",
      `${appMeta.reference} state=${appMeta.state} payment=${appMeta.payment?.status}`,
    );
    await applicantMain.close();

    const director = await openPage(chrome.cdp);
    check("c1.director.sign-in", await demoSignIn(director, "bee.director"), "director demo sign-in");
    await director.goto(`${WEB}/app/manufacturer/director`);
    await director.waitFor(`!!document.querySelector('[data-testid=director-approve]')`, 60000);
    await director.eval(`document.querySelector('[data-testid=director-approve]').click(); true`);
    await director.waitFor(`(document.body.textContent || '').includes('approved')`, 60000);
    const afterApprove = await director.eval(`fetch('/api/runtime/manufacturer-onboarding/${appMeta.id}', { credentials: 'include' }).then(r => r.json())`);
    const obs = psql(
      `SELECT started_on::text, ends_on::text FROM app.manufacturer_onboarding_observation WHERE application_id = '${appMeta.id}'`,
    );
    const [started, ends] = obs.split("|");
    const daysApart =
      started && ends ? Math.round((Date.parse(ends) - Date.parse(started)) / (86400000)) : -1;
    evidence.directorApproval = {
      reference: afterApprove.reference,
      phase: afterApprove.state,
      permitteeNumber: afterApprove.permitteeNumber,
      observationStarted: started,
      observationEnds: ends,
      calendarDaysBetween: daysApart,
    };
    check(
      "c1.director.approve-observation",
      afterApprove.state === "active_observation" && !!afterApprove.permitteeNumber && daysApart === 15,
      `permittee=${afterApprove.permitteeNumber} obs ${started}→${ends} (${daysApart}d)`,
    );
    check(
      "c1.no-observation-close-ui",
      !(await director.eval(`!!document.querySelector('[data-testid*=observation-close]')`)),
      "no browser observation-close control",
    );
    await director.close();

    const finance = await openPage(chrome.cdp);
    check("c1.finance.sign-in", await demoSignIn(finance, "bee.finance"), "finance demo sign-in");
    await finance.goto(`${WEB}/app/manufacturer/monitoring`);
    await finance.waitFor(`!!document.querySelector('[data-testid=raise-anomaly-submit]')`, 60000);
    await finance.eval(`document.querySelector('[data-testid=anomaly-summary]').value = 'Synthetic ledger mismatch (C1 demo)'; true`);
    await finance.eval(`document.querySelector('[data-testid=raise-anomaly-submit]').click(); true`);
    await finance.waitFor(`(document.body.textContent || '').includes('hold')`, 60000);
    const onHold = await finance.eval(`fetch('/api/runtime/manufacturer-onboarding/${appMeta.id}', { credentials: 'include' }).then(r => r.json())`);
    check("c1.finance.anomaly-hold", onHold.state === "on_hold", `state=${onHold.state}`);
    check(
      "c1.finance.cannot-resolve",
      !(await finance.eval(`!!document.querySelector('[data-testid=director-resolve]')`)),
      "finance sees no resolve button",
    );
    await finance.close();

    const director2 = await openPage(chrome.cdp);
    await demoSignIn(director2, "bee.director");
    await director2.goto(`${WEB}/app/manufacturer/monitoring`);
    await director2.waitFor(`!!document.querySelector('[data-testid=director-resolve]')`, 60000);
    await director2.eval(`document.querySelector('[data-testid=director-hold-note]').value = 'Cleared after review (C1)'; true`);
    await director2.eval(`document.querySelector('[data-testid=director-resolve]').click(); true`);
    await director2.waitFor(`(document.body.textContent || '').includes('active observation')`, 60000);
    const resolved = await director2.eval(`fetch('/api/runtime/manufacturer-onboarding/${appMeta.id}', { credentials: 'include' }).then(r => r.json())`);
    check("c1.director.resolve-hold", resolved.state === "active_observation", `state=${resolved.state}`);
    evidence.anomaly = { actor: "bee.finance", result: "on_hold", directorResolve: resolved.state };
    await director2.close();

    const ngrokUrl = fs.existsSync(path.join(RUN_DIR, "ngrok.url")) ? fs.readFileSync(path.join(RUN_DIR, "ngrok.url"), "utf8").trim() : "";
    evidence.ngrok = ngrokUrl || "(not recorded)";
    fs.writeFileSync(EVIDENCE, JSON.stringify(evidence, null, 2));
    check("c1.evidence-written", fs.existsSync(EVIDENCE), EVIDENCE);
  } finally {
    await chrome.close();
  }
  console.log(`c1 journey: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  check("c1.run", false, e.message);
  process.exit(1);
});
