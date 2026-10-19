/* eslint-disable */
/** Brief C3A: five-role menu smoke (Manufacturer, Finance, Director, Secretary, Admin) + Admin read-only banner on operational screens. */
const totp = require("./totp.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");

const PERSONAS = [
  { key: "manufacturer", user: "nova.applicant", groups: 4, forbidden: "/app/finance/finance-queue" },
  { key: "finance", user: "bee.finance", groups: 4, forbidden: "/app/workflow/my-approvals" },
  { key: "director", user: "bee.director", groups: 4, forbidden: "/app/registrations/fees" },
  { key: "secretary", user: "bee.secretary", groups: 4, forbidden: "/app/manufacturer/onboarding" },
  {
    key: "admin",
    user: "bee.admin",
    groups: 4,
    adminBannerRoute: "/app/registrations/requests",
    adminRegisterRoute: "/app/registrations/register",
    menuGroupIds: ["admin.executive", "admin.registration", "admin.labels", "admin.operations"],
  },
];

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(42)} ${detail}`);
}

async function waitForNav(page) {
  await page.waitFor(`!!document.querySelector('[data-testid="runtime-nav"]')`, 30000);
}

async function menuGroups(page) {
  return page.eval(`document.querySelectorAll('[data-testid="runtime-nav"] [data-nav-group-button]').length`);
}

/** True when the screen is outside the signed-in role's menu (prototype guard or runtime deep link). */
async function refusedUnrelatedScreen(page, href) {
  const path = href.split("?")[0];
  await page.goto(`${WEB}${href}`);
  await page.waitFor(`location.pathname.startsWith(${JSON.stringify(path)})`, 20000);
  return page.eval(`(() => {
    if (document.querySelector('[data-testid="route-guard-refused"]')) return true;
    const inMenu = [...document.querySelectorAll('[data-testid="runtime-nav"] a[href]')].some((a) => (a.getAttribute("href") || "").startsWith(${JSON.stringify(path)}));
    return !inMenu;
  })()`);
}

/** Opens each Admin group in turn and checks it exposes at least one child link (accordion allows one extra open group). */
async function traverseAdminGroups(page, ids) {
  for (const id of ids) {
    await page.eval(`(() => {
      const btn = document.querySelector('[data-nav-id="${id}"][data-nav-group-button]');
      if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
    })()`);
    const open = await page.waitFor(`document.querySelector('[data-nav-id="${id}"][data-nav-group-button]')?.getAttribute('aria-expanded') === 'true'`, 5000);
    const child = await page.eval(`!!document.querySelector('[id="nav-panel-${id}"] [data-nav-id]')`);
    if (!open || !child) return false;
  }
  return true;
}

(async () => {
  const chrome = await launchChrome();
  try {
    for (const p of PERSONAS) {
      await totp.ensureEnrolled(p.user, { allowProtected: true });
      const page = await openPage(chrome.cdp);
      const signedIn = await signIn(page, p.user);
      if (!signedIn) throw new Error(`${p.key}: sign-in did not reach /app with session badge`);
      await page.goto(`${WEB}/app`);
      await page.waitFor("location.pathname === '/app'", 20000);
      await waitForNav(page);
      const groups = await menuGroups(page);
      check(`${p.key}.menu-groups`, groups === p.groups, `groups=${groups}`);
      if (p.forbidden) {
        const refused = await refusedUnrelatedScreen(page, p.forbidden);
        check(`${p.key}.forbidden-route`, refused, p.forbidden);
      }
      if (p.menuGroupIds) {
        await page.goto(`${WEB}/app`);
        await waitForNav(page);
        const traversed = await traverseAdminGroups(page, p.menuGroupIds);
        check("admin.menu-four-groups-traversed", traversed, p.menuGroupIds.join(","));
      }
      if (p.adminBannerRoute) {
        await page.goto(`${WEB}${p.adminBannerRoute}`);
        await page.waitFor(`location.pathname === ${JSON.stringify(p.adminBannerRoute)}`, 20000);
        await page.waitFor(`!!document.querySelector('[data-testid="admin-demonstration-banner"]')`, 20000);
        const banner = await page.eval(`!!document.querySelector('[data-testid="admin-demonstration-banner"]')`);
        const regNew = await page.eval(`!!document.querySelector('[data-testid="reg-new"]')`);
        check("admin.read-only-banner", banner, p.adminBannerRoute);
        check("admin.no-reg-new-action", !regNew, "New request hidden");
        const me = await page.eval(`fetch('/api/runtime/me',{cache:'no-store'}).then(r=>r.ok?r.json():null)`);
        check("admin.me-read-only-flag", me?.adminDemonstrationReadOnly === true, String(me?.adminDemonstrationReadOnly));
      }
      if (p.adminRegisterRoute) {
        await page.goto(`${WEB}${p.adminRegisterRoute}`);
        await page.waitFor(`location.pathname === ${JSON.stringify(p.adminRegisterRoute)}`, 20000);
        await page.waitFor(`!!document.querySelector('[data-testid="admin-demonstration-banner"]')`, 20000);
        const banner = await page.eval(`!!document.querySelector('[data-testid="admin-demonstration-banner"]')`);
        const propose = await page.eval(`!!document.querySelector('[data-testid^="rvk-propose-"]')`);
        const decide = await page.eval(`!!document.querySelector('[data-testid^="rvk-approve-"], [data-testid^="rvk-reject-"], [data-testid^="rvk-withdraw-"]')`);
        check("admin.register-banner", banner, p.adminRegisterRoute);
        check("admin.register-no-propose", !propose, "no propose buttons");
        check("admin.register-no-decide", !decide, "no approve/reject/withdraw");
        const proposeApi = await page.eval(`fetch('/api/runtime/register-revocations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'c3a-admin-probe-' + Date.now() },
          body: JSON.stringify({ targetKind: 'brand', targetId: '00000000-0000-4000-d000-000000000001', action: 'revoke', reason: 'probe' }),
        }).then(async (r) => ({ status: r.status, error: (await r.json().catch(() => ({}))).error }))`);
        check("admin.register-mutation-forbidden", proposeApi.status === 403 && proposeApi.error === "role_not_permitted", `${proposeApi.status} ${proposeApi.error}`);
      }
      await page.close();
    }
  } finally {
    await chrome.close();
  }
  console.log(`c3a five-role checks: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
