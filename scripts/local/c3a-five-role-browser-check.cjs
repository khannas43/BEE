/* eslint-disable */
/** Brief C3A: five-role menu smoke (Manufacturer, Finance, Director, Secretary, Admin) + Admin read-only banner on an operational screen. */
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");

const PERSONAS = [
  { key: "manufacturer", user: "nova.applicant", groups: 4, forbidden: "/app/finance/finance-queue" },
  { key: "finance", user: "bee.finance", groups: 4, forbidden: "/app/workflow/my-approvals" },
  { key: "director", user: "bee.director", groups: 4, forbidden: "/app/registrations/fees" },
  { key: "secretary", user: "bee.secretary", groups: 4, forbidden: "/app/manufacturer/onboarding" },
  { key: "admin", user: "bee.admin", groups: 4, adminBannerRoute: "/app/registrations/requests" },
];

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(42)} ${detail}`);
}

async function menuGroups(page) {
  return page.eval(`(() => [...document.querySelectorAll('[data-nav-id][data-nav-kind="group"]')].map((b) => b.getAttribute('data-nav-id'))).length`);
}

async function canOpen(page, href) {
  await page.goto(`${WEB}${href}`);
  await page.waitFor(`location.pathname.startsWith(${JSON.stringify(href.split("?")[0])})`, 20000);
  return page.eval(`(() => !document.querySelector('[data-testid="route-guard-refused"]') && !document.body.innerText.includes('Not in your menu'))()`);
}

(async () => {
  const chrome = await launchChrome();
  try {
    for (const p of PERSONAS) {
      const page = await openPage(chrome.cdp);
      await signIn(page, p.user);
      await page.goto(`${WEB}/app`);
      await page.waitFor("location.pathname === '/app'", 20000);
      const groups = await menuGroups(page);
      check(`${p.key}.menu-groups`, groups === p.groups, `groups=${groups}`);
      if (p.forbidden) {
        const ok = !(await canOpen(page, p.forbidden));
        check(`${p.key}.forbidden-route`, ok, p.forbidden);
      }
      if (p.adminBannerRoute) {
        await page.goto(`${WEB}${p.adminBannerRoute}`);
        await page.waitFor(`location.pathname === ${JSON.stringify(p.adminBannerRoute)}`, 20000);
        const banner = await page.eval(`!!document.querySelector('[data-testid="admin-demonstration-banner"]')`);
        const regNew = await page.eval(`!!document.querySelector('[data-testid="reg-new"]')`);
        check("admin.read-only-banner", banner, p.adminBannerRoute);
        check("admin.no-reg-new-action", !regNew, "New request hidden");
        const me = await page.eval(`fetch('/api/runtime/me',{cache:'no-store'}).then(r=>r.ok?r.json():null)`);
        check("admin.me-read-only-flag", me?.adminDemonstrationReadOnly === true, String(me?.adminDemonstrationReadOnly));
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
