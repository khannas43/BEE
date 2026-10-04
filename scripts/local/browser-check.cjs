/* eslint-disable */
/**
 * WP02.1 browser check: signs in Nova and PixelCert in headless Chrome (fresh
 * profile each, so no preview role is set) and fails if any prototype screen
 * shows the preview role as if it were the signed-in identity.
 *
 *   node scripts/local/browser-check.cjs
 *
 * Uses the Chrome DevTools Protocol directly; no npm dependency. Appends JSON
 * lines to $AUTH_RESULTS when set (used by local:check). Screenshots go to
 * .local/run/browser-<user>.png. Signs in disposable twins of the personas
 * (scripts/local/test-identities.cjs); check ids keep the persona names.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");

const env = (k, d) => process.env[k] || d;
const WEB = `http://127.0.0.1:${env("BEE_WEB_PORT", "3100")}`;
const PASSWORD = env("BEE_DEV_USER_PASSWORD", "bee-local-dev");
const CHROME = env("BEE_CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
const RUN_DIR = path.join(__dirname, "../../.local/run");
const SCREENS = ["/app", "/app/screens", "/app/workflow/my-approvals", "/app/identity/organisation-users", "/app/registrations/record"];

const USERS = [
  { username: "nova.applicant", roles: "manufacturer (own-org)", org: "NOVA" },
  { username: "pixel.applicant", roles: "agency (own-org)", org: "PIXEL" },
];

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(34)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- minimal CDP client ---------- */
class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.waiting = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.waiting.has(m.id)) {
        const { resolve, reject } = this.waiting.get(m.id);
        this.waiting.delete(m.id);
        m.error ? reject(new Error(`${m.error.message}`)) : resolve(m.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
  }
}

async function launchChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bee-browser-check-"));
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
  const portFile = path.join(dir, "DevToolsActivePort");
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const [port, wsPath] = fs.readFileSync(portFile, "utf8").trim().split("\n");
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  const exited = new Promise((r) => proc.once("exit", r));
  return {
    cdp: new Cdp(ws),
    close: async () => {
      try { ws.close(); } catch {}
      proc.kill();
      await Promise.race([exited, sleep(5000)]);
      // Chrome's helper processes can still be writing to the profile after the main process exits. Removing the temp
      // profile is housekeeping, so it must never fail a check: retry for a while, then leave the folder behind.
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 15, retryDelay: 300 }); } catch { /* leftover temp folder is harmless */ }
    },
  };
}

async function openPage(cdp) {
  const { browserContextId } = await cdp.send("Target.createBrowserContext");
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const page = {
    eval: async (expression) => {
      const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    goto: (url) => cdp.send("Page.navigate", { url }, sessionId),
    send: (method, params = {}) => cdp.send(method, params, sessionId),
    waitFor: async (expression, timeoutMs = 60000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        try { if (await page.eval(expression)) return true; } catch {}
        await sleep(250);
      }
      return false;
    },
    screenshot: async (file) => {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    },
    close: () => cdp.send("Target.disposeBrowserContext", { browserContextId }),
  };
  await cdp.send("Page.enable", {}, sessionId);
  return page;
}

/**
 * Runs in the page. Removes every element marked data-preview-role, then looks
 * for the preview role's name (or "Administrator") in what remains. Also checks
 * every marked element says "(preview)" or is the "Preview as" switcher.
 */
const AUDIT = `(() => {
  const ROLE_NAMES = { admin: "BEE Administrator", programme: "Programme Officer", reviewer: "Reviewer & Approver", director: "Director", secretary: "Secretary", finance: "BEE Finance", helpdesk: "Helpdesk Agent", auditor: "Auditor", manufacturer: "Manufacturer", agency: "Registered Agency", iame: "IAME (Independent Assessor)", sda: "State Designated Agency", laboratory: "Testing Laboratory" };
  const previewRole = localStorage.getItem("bee-role") || "admin";
  const previewName = ROLE_NAMES[previewRole];
  const clone = document.body.cloneNode(true);
  clone.querySelectorAll("script, style, template, noscript, [data-preview-role]").forEach((n) => n.remove());
  const outside = (clone.textContent || "").replace(/\\s+/g, " ");
  const escape = (s) => s.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
  const unmarked = (outside.match(new RegExp(escape(previewName) + "(?! \\\\(preview\\\\))", "g")) || []).length;
  const administrator = (outside.match(/Administrator(?! \\(preview\\))/g) || []).length;
  const marked = [...document.querySelectorAll("[data-preview-role]")].map((n) => n.textContent.replace(/\\s+/g, " ").trim());
  const badMarked = marked.filter((t) => !t.includes("(preview)") && !/Preview as/i.test(t));
  const text = (sel) => document.querySelector(sel)?.textContent.replace(/\\s+/g, " ").trim() || "";
  const jwt = /eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}/;
  const storage = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
  return { path: location.pathname, previewRole, previewName, unmarked, administrator, markedCount: marked.length, badMarked, banner: text("[data-testid=preview-banner]"), identity: text("[data-testid=signed-in-identity]"), badge: text("[data-testid=session-badge]"), cookie: document.cookie, tokenVisible: jwt.test(document.cookie + storage + document.documentElement.outerHTML) };
})()`;

async function signIn(page, username) {
  await page.goto(`${WEB}/api/auth/login?returnTo=/app`);
  if (!(await page.waitFor(`!!document.getElementById("kc-form-login")`))) throw new Error("Keycloak login form did not appear");
  await page.eval(`(() => { document.getElementById("username").value = ${JSON.stringify(username)}; document.getElementById("password").value = ${JSON.stringify(PASSWORD)}; document.getElementById("kc-form-login").submit(); return true; })()`);
  if (!(await page.waitFor(`!!document.getElementById("kc-otp-login-form")`))) throw new Error("Keycloak OTP challenge did not appear");
  const code = await totp.nextCode(username);
  await page.eval(`(() => { document.getElementById("otp").value = ${JSON.stringify(code)}; document.getElementById("kc-otp-login-form").submit(); return true; })()`);
  return page.waitFor(`location.origin === ${JSON.stringify(WEB)} && location.pathname === "/app" && !!document.querySelector("[data-testid=session-badge]")`);
}

const identityOk = (a, u) => [a.identity, a.badge].every((t) => t.includes(u.displayName) && t.includes(u.roles) && t.includes(u.org)) && !/Administrator/.test(a.badge + a.identity);

async function main() {
  if (!fs.existsSync(CHROME)) {
    check("browser.chrome", false, `Chrome not found at ${CHROME} (set BEE_CHROME)`);
    return;
  }
  const chrome = await launchChrome();
  try {
    for (const u of USERS) {
      await totp.ensureEnrolled(ids.name(u.username));
      const page = await openPage(chrome.cdp);
      const signedIn = await signIn(page, ids.name(u.username));
      check(`browser.${u.username}.signed-in`, signedIn, signedIn ? `password, then the Keycloak TOTP challenge, landed on /app with the signed-in badge (fresh profile, no preview role chosen)` : "sign-in did not reach /app");
      if (!signedIn) { await page.close(); continue; }
      const me = await page.eval(`fetch("/api/runtime/me").then((r) => r.json())`);
      u.displayName = me.displayName;
      check(`browser.${u.username}.spring-identity`, !!u.displayName && (me.organisations || []).map((o) => o.code).join(",") === u.org, `Spring /api/me: ${u.displayName}, org ${(me.organisations || []).map((o) => o.code).join(",")}`);
      await page.waitFor(`document.querySelector("[data-testid=signed-in-identity]")?.textContent.includes(${JSON.stringify(u.displayName)})`, 15000);

      for (const screen of SCREENS) {
        if (screen !== "/app") {
          await page.goto(`${WEB}${screen}`);
          await page.waitFor(`location.pathname === ${JSON.stringify(screen)} && document.querySelector("[data-testid=signed-in-identity]")?.textContent.includes(${JSON.stringify(u.displayName)})`, 60000);
        }
        const a = await page.eval(AUDIT);
        check(`browser.${u.username}.${screen === "/app" ? "dashboard" : screen.split("/").pop()}`,
          a.banner.includes("Development preview") && identityOk(a, u) && a.unmarked === 0 && a.administrator === 0 && a.badMarked.length === 0,
          `${screen}: preview banner ${a.banner.includes("Development preview") ? "shown" : "MISSING"}; identity "${a.identity}"; preview role ${a.previewName} appears only as preview (${a.markedCount} marked, ${a.unmarked} unmarked, ${a.administrator} bare "Administrator")${a.badMarked.length ? "; marked without (preview): " + a.badMarked.join(" | ") : ""}`);
        if (screen === "/app") await page.screenshot(path.join(RUN_DIR, `browser-${u.username}.png`));
      }

      // A different preview role must stay a preview and leave the identity unchanged.
      await page.eval(`localStorage.setItem("bee-role", "reviewer"); location.assign("/app"); true`);
      await page.waitFor(`document.querySelector("[data-testid=signed-in-identity]")?.textContent.includes(${JSON.stringify(u.displayName)}) && document.querySelector("[data-testid=preview-banner]")?.textContent.includes("Reviewer")`, 30000);
      let a = await page.eval(AUDIT);
      check(`browser.${u.username}.other-preview-role`, identityOk(a, u) && a.unmarked === 0 && a.badMarked.length === 0, `preview switched to ${a.previewName}: identity still "${a.identity}"; ${a.unmarked} unmarked uses`);

      // Self-test: an unmarked Administrator label must be caught.
      await page.eval(`localStorage.removeItem("bee-role"); location.assign("/app"); true`);
      await page.waitFor(`document.querySelector("[data-testid=signed-in-identity]")?.textContent.includes(${JSON.stringify(u.displayName)})`, 30000);
      await page.eval(`(() => { const d = document.createElement("div"); d.textContent = "Signed in as BEE Administrator"; document.body.appendChild(d); return true; })()`);
      a = await page.eval(AUDIT);
      check(`browser.${u.username}.detects-misleading`, a.unmarked > 0 && a.administrator > 0, `injected unmarked "BEE Administrator" label is detected (${a.unmarked} unmarked)`);

      check(`browser.${u.username}.no-token-in-page`, a.cookie === "" && !a.tokenVisible, `document.cookie "${a.cookie}"; JWT visible to page script: ${a.tokenVisible}`);

      // Sign out through the top-bar form.
      await page.eval(`document.querySelector("[data-testid=session-badge] form button").click(); true`);
      const out = await page.waitFor(`location.pathname === "/login" && location.search.includes("signedOut=1")`, 20000);
      const after = out ? await page.eval(`fetch("/api/auth/session").then((r) => r.json())`) : null;
      check(`browser.${u.username}.sign-out`, out && after?.authenticated === false, `top-bar sign-out -> /login?signedOut=1; session ${JSON.stringify(after)}`);
      await page.close();
    }

    // Login page shows only implemented controls.
    const page = await openPage(chrome.cdp);
    await page.goto(`${WEB}/login`);
    await page.waitFor(`!!document.querySelector("[data-testid=implemented-controls]")`, 60000);
    const login = await page.eval(`document.body.textContent`);
    const claims = ["MFA enforced", "RBAC + object policy", "Every action audited"].filter((c) => login.includes(c));
    check("browser.login-claims", claims.length === 0 && login.includes("PKCE") && login.includes("authenticator-app code (TOTP)"), `unproven claims shown: ${claims.length ? claims.join(", ") : "none"}; implemented controls listed, including TOTP`);
    await page.close();
  } finally {
    await chrome.close();
  }
}

module.exports = { WEB, PASSWORD, CHROME, RUN_DIR, launchChrome, openPage, signIn };

if (require.main === module) {
  ids.withIdentities("test", main)
    .catch((e) => check("browser.run", false, `aborted: ${e.message}`))
    .then(() => {
      console.log(`browser checks: ${pass} passed, ${fail} failed`);
      process.exit(fail ? 1 : 0);
    });
}
