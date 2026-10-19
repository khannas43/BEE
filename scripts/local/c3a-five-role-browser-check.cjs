/* eslint-disable */
/** Brief C3B: five-role menu smoke + simplified role selector + Admin screen visibility without demo banners. */
const totp = require("./totp.cjs");
const { WEB, launchChrome, openPage, signIn } = require("./browser-check.cjs");

const ADMIN_NOTE = /Admin demonstration view|read-only Admin|Consolidated view of every screen/i;

const PERSONAS = [
  { key: "manufacturer", user: "nova.applicant", groups: 4, forbidden: "/app/finance/finance-queue" },
  { key: "finance", user: "bee.finance", groups: 4, forbidden: "/app/workflow/my-approvals" },
  { key: "director", user: "bee.director", groups: 4, forbidden: "/app/registrations/fees" },
  { key: "secretary", user: "bee.secretary", groups: 4, forbidden: "/app/manufacturer/onboarding" },
  {
    key: "admin",
    user: "bee.admin",
    groups: 4,
    adminRegisterRoute: "/app/registrations/register",
    adminOperationalRoute: "/app/registrations/requests",
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

async function roleDropdown(page) {
  return page.eval(`(() => {
    const sel = document.querySelector('[data-testid="visible-role-selector"]');
    if (!sel) return null;
    return [...sel.options].map((o) => ({ value: o.value, text: (o.textContent || "").trim() }));
  })()`);
}

async function pageForbiddenCopy(page) {
  await page.waitFor(`!!document.body`, 10000);
  return page.eval(`document.body?.innerText || ""`);
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

async function expandAllAdminGroups(page, ids) {
  for (const id of ids) {
    await page.eval(`(() => {
      const btn = document.querySelector('[data-nav-id="${id}"][data-nav-group-button]');
      if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
    })()`);
    await page.waitFor(`document.querySelector('[data-nav-id="${id}"][data-nav-group-button]')?.getAttribute('aria-expanded') === 'true'`, 5000);
  }
}

async function adminMenuHrefs(page, ids) {
  await expandAllAdminGroups(page, ids);
  return page.eval(`[...new Set([...document.querySelectorAll('[data-testid="runtime-nav"] a[href]')].map((a) => a.getAttribute("href")).filter(Boolean))]`);
}

async function adminCanOpenRoute(page, href) {
  const path = href.split("?")[0];
  await page.goto(`${WEB}${href}`);
  await page.waitFor(`location.pathname.startsWith(${JSON.stringify(path)})`, 25000);
  const refused = await page.eval(`!!document.querySelector('[data-testid="route-guard-refused"]')`);
  const banner = await page.eval(`!!document.querySelector('[data-testid="admin-demonstration-banner"]')`);
  const text = await pageForbiddenCopy(page);
  return !refused && !banner && !ADMIN_NOTE.test(text);
}

(async () => {
  const chrome = await launchChrome();
  try {
    {
      const page = await openPage(chrome.cdp);
      await page.goto(`${WEB}/login`);
      await page.waitFor(`!!document.getElementById("demo-username")`, 15000);
      const loginForm = await page.eval(`!!document.querySelector('[data-testid="demo-login-form"]') && !document.body.innerText.includes("Sign in with BEE identity")`);
      check("login.oval-demo-form", loginForm, "/login");
      await page.close();
    }
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
      const selectorHidden = await page.eval(`!document.querySelector('[data-testid="visible-role-selector"]')`);
      check(`${p.key}.role-selector-hidden-when-signed-in`, selectorHidden, "top bar must not switch identity");
      const meBefore = await page.eval(`fetch('/api/runtime/me',{cache:'no-store'}).then(r=>r.ok?r.json():null)`);
      const badgeBefore = await page.eval(`document.querySelector('[data-testid="session-badge"]')?.textContent?.replace(/\\s+/g,' ').trim() || ""`);
      await page.eval(`window.__demoLoginPosts = 0; const f = window.fetch; window.fetch = function(...a) { if (String(a[0]||'').includes('/api/runtime/demo/login')) window.__demoLoginPosts++; return f.apply(this, a); };`);
      const options = await roleDropdown(page);
      check(`${p.key}.no-dropdown-to-change`, options === null, "selector absent");
      const meAfter = await page.eval(`fetch('/api/runtime/me',{cache:'no-store'}).then(r=>r.ok?r.json():null)`);
      const badgeAfter = await page.eval(`document.querySelector('[data-testid="session-badge"]')?.textContent?.replace(/\\s+/g,' ').trim() || ""`);
      const demoPosts = await page.eval(`window.__demoLoginPosts || 0`);
      check(`${p.key}.me-unchanged`, meBefore?.effectiveRoles?.[0]?.role === meAfter?.effectiveRoles?.[0]?.role, `${meBefore?.effectiveRoles?.[0]?.role} → ${meAfter?.effectiveRoles?.[0]?.role}`);
      check(
        `${p.key}.identity-unchanged`,
        meBefore?.displayName === meAfter?.displayName && badgeBefore === badgeAfter && badgeBefore.length > 0,
        meBefore?.displayName ?? badgeBefore.slice(0, 40),
      );
      check(`${p.key}.no-demo-login-from-topbar`, demoPosts === 0, `posts=${demoPosts}`);
      if (p.forbidden) {
        const refused = await refusedUnrelatedScreen(page, p.forbidden);
        check(`${p.key}.forbidden-route`, refused, p.forbidden);
      }
      if (p.menuGroupIds) {
        await page.goto(`${WEB}/app`);
        await waitForNav(page);
        const traversed = await traverseAdminGroups(page, p.menuGroupIds);
        check("admin.menu-four-groups-traversed", traversed, p.menuGroupIds.join(","));
        const hrefs = await adminMenuHrefs(page, p.menuGroupIds);
        let opened = 0;
        for (const href of hrefs) {
          const ok = await adminCanOpenRoute(page, href);
          if (!ok) check(`admin.open.${href}`, false, "refused, banner, or forbidden copy");
          else opened++;
        }
        check("admin.opens-every-menu-route", opened === hrefs.length, `${opened}/${hrefs.length} menu links`);
      }
      if (p.adminOperationalRoute) {
        await page.goto(`${WEB}${p.adminOperationalRoute}`);
        await page.waitFor(`location.pathname === ${JSON.stringify(p.adminOperationalRoute)}`, 20000);
        await page.waitFor(
          `fetch('/api/runtime/me',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(m=>m?.adminDemonstrationReadOnly===true)`,
          20000,
        );
        await page.waitFor(`!document.querySelector('[data-testid="reg-list-loading"]')`, 20000);
        const banner = await page.eval(`!!document.querySelector('[data-testid="admin-demonstration-banner"]')`);
        const regNew = await page.eval(`!!document.querySelector('[data-testid="reg-new"]')`);
        const text = await pageForbiddenCopy(page);
        check("admin.no-banner-on-operational", !banner && !ADMIN_NOTE.test(text), p.adminOperationalRoute);
        check("admin.no-reg-new-action", !regNew, "New request hidden");
        const me = await page.eval(`fetch('/api/runtime/me',{cache:'no-store'}).then(r=>r.ok?r.json():null)`);
        check("admin.me-read-only-flag", me?.adminDemonstrationReadOnly === true, String(me?.adminDemonstrationReadOnly));
      }
      if (p.adminRegisterRoute) {
        await page.goto(`${WEB}${p.adminRegisterRoute}`);
        await page.waitFor(`location.pathname === ${JSON.stringify(p.adminRegisterRoute)}`, 20000);
        const banner = await page.eval(`!!document.querySelector('[data-testid="admin-demonstration-banner"]')`);
        const propose = await page.eval(`!!document.querySelector('[data-testid^="rvk-propose-"]')`);
        const decide = await page.eval(`!!document.querySelector('[data-testid^="rvk-approve-"], [data-testid^="rvk-reject-"], [data-testid^="rvk-withdraw-"]')`);
        const text = await pageForbiddenCopy(page);
        check("admin.register-no-banner", !banner && !ADMIN_NOTE.test(text), p.adminRegisterRoute);
        check("admin.register-no-propose", !propose, "no propose buttons");
        check("admin.register-no-decide", !decide, "no approve/reject/withdraw");
        const proposeApi = await page.eval(`fetch('/api/runtime/register-revocations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'c3b-admin-probe-' + Date.now() },
          body: JSON.stringify({ targetKind: 'brand', targetId: '00000000-0000-4000-d000-000000000001', action: 'revoke', reason: 'probe' }),
        }).then(async (r) => ({ status: r.status, error: (await r.json().catch(() => ({}))).error }))`);
        check("admin.register-mutation-forbidden", proposeApi.status === 403 && proposeApi.error === "role_not_permitted", `${proposeApi.status} ${proposeApi.error}`);
      }
      await page.close();
    }
  } finally {
    await chrome.close();
  }
  console.log(`c3 five-role checks: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
