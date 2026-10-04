/* eslint-disable */
/**
 * WP05.1a live check: the model-application list and detail screen
 * (/app/model-label/model-dashboard) in headless Chrome, signed in through Keycloak
 * (password + TOTP), reading through the real Next.js BFF and Spring API.
 *
 *   npm run local:read-ui      (runtime must be up; stops and restarts Spring once)
 *
 * Signs in disposable twins (scripts/local/test-identities.cjs), never the seeded users.
 * Expected records come from bee_app directly (organisation ownership), not from Spring,
 * so the screen is compared with an independent source. Nothing is mocked: the loading
 * state is made observable by delaying the network in DevTools, the outage is a real
 * Spring stop, and the expired session is a real Keycloak logout followed by token expiry.
 * Screenshots go to .local/run/read-ui-*.png. Appends JSON lines to $AUTH_RESULTS when set.
 *
 * Every browser profile is fresh and the development preview role is left at its default
 * (BEE Administrator): the screen is reached from the sidebar entry that the Spring
 * identity produces, not from a preview menu. Switching the preview role must change
 * neither the records nor the entry, while the preview filter still applies elsewhere.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const totp = require("./totp.cjs");
const ids = require("./test-identities.cjs");
const pc = require("./portal-client.cjs");
const { WEB, CHROME, RUN_DIR, launchChrome, openPage, signIn } = require("./browser-check.cjs");

const ROUTE = "/app/model-label/model-dashboard";
const UNKNOWN = "00000000-0000-4000-c000-00000000ffff";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(40)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}

function sql(statement) {
  return execFileSync("docker", ["exec", "-i", "-e", `PGPASSWORD=${process.env.BEE_APP_DB_PASSWORD || "bee-local-app"}`, "bee-local-postgres", "psql", "-h", "127.0.0.1", "-U", "bee_app", "-d", "bee_app", "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "|", "-c", statement]).toString().trim();
}

/** Every application with its owning organisation, straight from bee_app. */
function applications() {
  return sql("SELECT a.id, a.reference, o.code, a.model_number FROM app.model_application a JOIN app.organisation o ON o.id = a.organisation_id ORDER BY a.reference")
    .split("\n").filter(Boolean).map((l) => { const [id, reference, org, model] = l.split("|"); return { id, reference, org, model }; });
}

/** What the screen shows now (runs in the page). */
const STATE = `(() => {
  const q = (s) => document.querySelector(s);
  const t = (s) => q(s)?.textContent.replace(/\\s+/g, " ").trim() ?? null;
  const err = (s) => q(s) ? { kind: q(s).dataset.failureKind, code: q(s).dataset.failureCode, text: t(s), signIn: !!q(s).querySelector('a[href^="/api/auth/login"]') } : null;
  return {
    path: location.pathname + location.search,
    loading: !!q("[data-testid=model-applications-loading]"),
    empty: t("[data-testid=model-applications-empty]"),
    refs: [...document.querySelectorAll("[data-testid^=model-app-ref-]")].map((n) => n.textContent.trim()),
    listError: err("[data-testid=model-applications-list-error]"),
    detailLoading: (t("[data-testid=model-applications-detail]") || "").includes("Loading application"),
    detailError: err("[data-testid=model-applications-detail-error]"),
    detail: Object.fromEntries([...document.querySelectorAll("[data-testid=model-applications-detail-fields] > div")].map((d) => [d.querySelector("dt").textContent.trim(), d.querySelector("dd").textContent.trim()])),
    identity: t("[data-testid=model-applications-identity]"),
    body: document.body.innerText,
    cookie: document.cookie,
  };
})()`;

const settled = `(() => { const s = ${STATE}; return !s.loading && (s.refs.length > 0 || s.empty !== null || s.listError !== null); })()`;
const detailSettled = `(() => { const s = ${STATE}; return !s.detailLoading && (Object.keys(s.detail).length > 0 || s.detailError !== null); })()`;

async function open(page, url, { detail = false } = {}) {
  await page.goto(`${WEB}${url}`);
  await page.waitFor(`location.pathname + location.search === ${JSON.stringify(url)}`, 30000);
  await page.waitFor(settled, 30000);
  if (detail) await page.waitFor(detailSettled, 30000);
  return page.eval(STATE);
}

/** Navigates with a delayed network and reports whether the loading copy was on screen. */
async function sawLoading(page, url, testid) {
  await page.send("Network.enable");
  await page.send("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
  try {
    await page.goto(`${WEB}${url}`);
    return await page.waitFor(`!!document.querySelector(${JSON.stringify(testid)}) || (document.querySelector("[data-testid=model-applications-detail]")?.textContent || "").includes(${JSON.stringify(testid)})`, 30000);
  } finally {
    await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
}

/** Sets the prototype preview role (localStorage on the portal origin). */
async function preview(page, role) {
  await page.eval(`location.origin === ${JSON.stringify(WEB)} || (() => { throw new Error("not on the portal origin"); })()`);
  await page.eval(`localStorage.setItem("bee-role", ${JSON.stringify(role)}); true`);
}

const READ_UI_MESSAGES_NO_SESSION = "Sign in to continue.";
const others = (all, org) => all.filter((a) => a.org !== org);
const leaks = (s, foreign) => foreign.filter((a) => s.body.includes(a.reference) || s.body.includes(a.id) || s.body.includes(a.model));

const SIMULATED = ["Scoping is simulated", "Your access", "Download or export", "Not in this preview", "not available to the current role"];
const NAV = "[data-testid=runtime-nav-model-dashboard]";
const focus = (page) => page.eval(`window.dispatchEvent(new Event("focus")); true`);
const hasNav = (page) => page.eval(`!!document.querySelector(${JSON.stringify(NAV)})`);

/** The route's own chrome: no preview-derived claims, only what is implemented. */
function chromeOk(s) {
  const bad = SIMULATED.filter((t) => s.body.includes(t));
  return { ok: bad.length === 0 && s.body.includes("Implemented here: List · View detail") && s.body.includes("This screen shows records from the BEE service"), bad };
}

async function main() {
  if (!fs.existsSync(CHROME)) return check("read-ui.chrome", false, `Chrome not found at ${CHROME} (set BEE_CHROME)`);
  const all = applications();
  const chrome = await launchChrome();
  const pages = {};
  try {
    /* ---------- signed out, default preview: no record data, no entry, sign-in offered ---------- */
    const anon = await openPage(chrome.cdp);
    let s = await open(anon, ROUTE);
    check("read-ui.signed-out", s.listError?.kind === "session" && s.listError.code === "no_session" && s.listError.signIn && s.refs.length === 0 && leaks(s, all).length === 0 && !(await hasNav(anon)) && !s.body.includes("Not in this preview"),
      `fresh profile, not signed in: the route renders (no preview filter) and shows "${READ_UI_MESSAGES_NO_SESSION}" with a sign-in link; no rows, no sidebar entry`);
    await anon.close();

    for (const [persona, org] of [["nova.applicant", "NOVA"], ["pixel.applicant", "PIXEL"]]) {
      const twin = ids.name(persona);
      await totp.ensureEnrolled(twin);
      const page = await openPage(chrome.cdp);
      pages[persona] = page;
      const ok = await signIn(page, twin);
      check(`read-ui.${persona}.signed-in`, ok, ok ? "fresh profile, Keycloak password + TOTP, landed on /app; no preview role selected" : "sign-in did not reach /app");
      if (!ok) continue;
      const own = all.filter((a) => a.org === org), foreign = others(all, org);
      const want = own.map((a) => a.reference).sort();

      /* the sidebar entry comes from /api/runtime/me, with the default preview role */
      const navShown = await page.waitFor(`!!document.querySelector(${JSON.stringify(NAV)})`, 20000);
      const previewRole = await page.eval(`localStorage.getItem("bee-role")`);
      await page.eval(`document.querySelector(${JSON.stringify(NAV)}).click(); true`);
      await page.waitFor(`location.pathname === ${JSON.stringify(ROUTE)}`, 20000);
      await page.waitFor(settled, 30000);
      s = await page.eval(STATE);
      check(`read-ui.${persona}.menu-entry`, navShown && previewRole === null && s.path === ROUTE,
        `sidebar "Your BEE records" entry present from the Spring identity (preview role ${previewRole ?? "default: BEE Administrator"}); clicking it opened ${s.path}`);
      check(`read-ui.${persona}.list`, JSON.stringify([...s.refs].sort()) === JSON.stringify(want) && s.body.includes(`${want.length} records`) && leaks(s, foreign).length === 0 && s.identity?.includes(org),
        `rows ${s.refs.join(", ")} = ${org}'s ${want.length} applications in bee_app; no other organisation's reference, id or model on screen`);
      const c = chromeOk(s);
      check(`read-ui.${persona}.route-chrome`, c.ok, c.ok ? `no simulated-scoping banner, no preview access chips; header says "Implemented here: List · View detail"; banner says the records come from the BEE service` : `still shows: ${c.bad.join(", ")}`);
      await page.screenshot(path.join(RUN_DIR, `read-ui-${persona}-list.png`));

      /* select a row: client navigation to ?id=, detail from its own GET */
      const pick = own[own.length - 1];
      await page.eval(`(() => { document.querySelector(${JSON.stringify(`[data-testid=model-app-open-${pick.reference}]`)}).click(); return true; })()`);
      await page.waitFor(`location.search === ${JSON.stringify(`?id=${pick.id}`)}`, 15000);
      await page.waitFor(detailSettled, 30000);
      s = await page.eval(STATE);
      check(`read-ui.${persona}.detail`, s.detail.Reference === pick.reference && s.detail.Organisation === org && s.detail["Record id"] === pick.id && s.detail["Model number"] === pick.model && leaks(s, foreign).length === 0,
        `clicked View on ${pick.reference}: detail shows ${s.detail.Reference}, ${s.detail.Organisation}, ${s.detail["Model number"]}, read basis ${s.detail["Read basis"]}`);
      await page.screenshot(path.join(RUN_DIR, `read-ui-${persona}-detail.png`));

      const loading = await sawLoading(page, ROUTE, "[data-testid=model-applications-loading]");
      await page.waitFor(settled, 30000);
      const detailLoading = await sawLoading(page, `${ROUTE}?id=${own[0].id}`, "Loading application");
      await page.waitFor(detailSettled, 30000);
      check(`read-ui.${persona}.loading`, loading && detailLoading, `with a 1.5 s network delay, "Loading model applications…" and "Loading application…" were shown before the data`);

      /* another organisation's id, an unknown id and a malformed id: one safe not-found state */
      const probes = [["cross-organisation", foreign[0].id], ["unknown", UNKNOWN], ["malformed", "not-a-uuid"]];
      const seen = [];
      for (const [label, id] of probes) {
        s = await open(page, `${ROUTE}?id=${encodeURIComponent(id)}`, { detail: true });
        seen.push({ label, err: s.detailError, leaked: leaks(s, foreign).map((a) => a.reference), fields: Object.keys(s.detail).length, refs: s.refs });
      }
      const first = JSON.stringify(seen[0].err);
      check(`read-ui.${persona}.not-found-identical`,
        seen.every((x) => x.err?.kind === "not_found" && JSON.stringify(x.err) === first && x.leaked.length === 0 && x.fields === 0 && JSON.stringify([...x.refs].sort()) === JSON.stringify(want)),
        `${probes.map((p) => `${p[0]} (${p[0] === "cross-organisation" ? foreign[0].reference : p[1]})`).join(", ")}: identical "${seen[0].err?.text}"; no detail fields, no foreign data; list unchanged`);
      if (persona === "nova.applicant") await page.screenshot(path.join(RUN_DIR, "read-ui-nova.applicant-not-found.png"));

      /* preview switching changes neither records nor entry on this route */
      const switched = [];
      for (const role of ["reviewer", "laboratory", "manufacturer", "agency", "admin"]) {
        await preview(page, role);
        s = await open(page, ROUTE);
        switched.push({ role, same: JSON.stringify([...s.refs].sort()) === JSON.stringify(want) && leaks(s, foreign).length === 0, nav: await hasNav(page), chrome: chromeOk(s).ok });
      }
      check(`read-ui.${persona}.preview-switching`, switched.every((x) => x.same && x.nav && x.chrome),
        `preview ${switched.map((x) => `${x.role}: ${x.same ? "same rows" : "ROWS CHANGED"}${x.nav ? "" : ", NO ENTRY"}${x.chrome ? "" : ", PREVIEW CHROME"}`).join("; ")}`);
      await page.eval(`localStorage.removeItem("bee-role"); true`);
      check(`read-ui.${persona}.no-token-in-page`, s.cookie === "" && !/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(s.body), `document.cookie "${s.cookie}"; no JWT in the page text`);
    }

    /* ---------- preview behaviour is unchanged elsewhere ---------- */
    {
      const nova = pages["nova.applicant"], other = "/app/administration/appliance-master";
      await preview(nova, "manufacturer");
      await nova.goto(`${WEB}${other}`);
      const denied = await nova.waitFor(`location.pathname === ${JSON.stringify(other)} && document.body.innerText.includes("Not in this preview")`, 30000);
      await nova.goto(`${WEB}/app/model-label/model-payment`);
      const banner = await nova.waitFor(`document.body.innerText.includes("Scoping is simulated") && document.body.innerText.includes("Your access")`, 30000);
      await preview(nova, "admin");
      await nova.goto(`${WEB}${other}`);
      const allowed = await nova.waitFor(`location.pathname === ${JSON.stringify(other)} && !!document.querySelector("h1") && !document.body.innerText.includes("Not in this preview") && !document.body.innerText.includes("not available to the current role")`, 30000);
      await nova.eval(`localStorage.removeItem("bee-role"); true`);
      check("read-ui.preview-elsewhere-unchanged", denied && banner && allowed,
        `${other}: manufacturer preview still "Not in this preview" (${denied}), admin preview still shows it (${allowed}); another partner screen still has the simulated-scoping banner and access chips (${banner})`);
    }

    /* ---------- empty and no read access: real Spring answers, no entry for these roles ---------- */
    for (const [persona, testCase] of [["bee.secretary", "empty"], ["lab.officer", "forbidden"]]) {
      const twin = ids.name(persona);
      await totp.ensureEnrolled(twin);
      const page = await openPage(chrome.cdp);
      const ok = await signIn(page, twin);
      await sleep(1500);
      const nav = ok ? await hasNav(page) : null;
      s = ok ? await open(page, ROUTE) : null;
      if (testCase === "empty") {
        const inStage = Number(sql("SELECT count(*) FROM app.model_application WHERE state = 'secretary_approval'"));
        check("read-ui.empty", ok && nav === false && inStage === 0 && s.empty === "No model applications are available to you." && s.refs.length === 0 && s.body.includes("0 records") && leaks(s, all).length === 0,
          `secretary twin, opened directly (no sidebar entry for this role): Spring reads only secretary_approval, bee_app has ${inStage} such rows: "${s?.empty}", 0 records`);
        if (ok) await page.screenshot(path.join(RUN_DIR, "read-ui-empty.png"));
      } else {
        check("read-ui.no-read-access", ok && nav === false && s.listError?.kind === "forbidden" && s.listError.code === "no_read_scope" && s.refs.length === 0 && leaks(s, all).length === 0,
          `laboratory twin (no model-application read rule), no sidebar entry, opened directly: "${s?.listError?.text}" (${s?.listError?.code}); no record data`);
        if (ok) await page.screenshot(path.join(RUN_DIR, "read-ui-no-read-access.png"));
      }
      await page.close();
    }

    /* ---------- role revoked while the page is open: the records go at the next revalidation ---------- */
    const nova = pages["nova.applicant"], novaOwn = all.filter((a) => a.org === "NOVA"), acct = ids.accountId("nova.applicant");
    await open(nova, `${ROUTE}?id=${novaOwn[0].id}`, { detail: true });
    const roles = sql(`SELECT id || '|' || active FROM app.role_assignment WHERE user_id = '${acct}'`).split("\n").filter(Boolean);
    let revoked, restored;
    try {
      sql(`UPDATE app.role_assignment SET active = false WHERE user_id = '${acct}'`);
      await focus(nova);
      await nova.waitFor(`(() => { const s = ${STATE}; return s.refs.length === 0 && !!s.listError && !!s.detailError; })()`, 20000);
      revoked = { ...(await nova.eval(STATE)), nav: await hasNav(nova) };
      await nova.screenshot(path.join(RUN_DIR, "read-ui-role-revoked.png"));
    } finally {
      for (const row of roles) { const [id, active] = row.split("|"); sql(`UPDATE app.role_assignment SET active = ${active === "t" || active === "true"} WHERE id = '${id}'`); }
    }
    await focus(nova);
    await nova.waitFor(`(() => { const s = ${STATE}; return s.refs.length > 0 && Object.keys(s.detail).length > 0; })()`, 20000);
    restored = { ...(await nova.eval(STATE)), nav: await hasNav(nova) };
    check("read-ui.role-revoked", revoked.refs.length === 0 && Object.keys(revoked.detail).length === 0 && revoked.listError?.code === "no_effective_role" && revoked.detailError?.code === "no_effective_role" && !revoked.nav && leaks(revoked, all).length === 0 && restored.refs.length === novaOwn.length && restored.nav,
      `role deactivated in bee_app with the list and ${novaOwn[0].reference} open: on the next revalidation (window focus) list and detail show "${revoked.listError?.text}" (${revoked.listError?.code}), no rows, sidebar entry gone; restored: ${restored.refs.length} rows and the entry again`);

    /* ---------- service unavailable: Spring really stopped, then started again ---------- */
    let down, downDetail, back;
    try {
      pc.runtime("stop_api");
      down = await open(nova, ROUTE);
      downDetail = await open(nova, `${ROUTE}?id=${novaOwn[0].id}`, { detail: true });
      await nova.screenshot(path.join(RUN_DIR, "read-ui-unavailable.png"));
    } finally {
      pc.runtime("start_api");
    }
    back = await open(nova, ROUTE);
    const unreachable = "The BEE service is not reachable. Try again later.";
    check("read-ui.service-unavailable",
      down.listError?.text.includes(unreachable) && downDetail.detailError?.text.includes(unreachable) && down.refs.length === 0 && Object.keys(downDetail.detail).length === 0 && back.refs.length === novaOwn.length,
      `Spring stopped: list and detail show the unreachable message, no rows or stale data; Spring restarted: ${back.refs.length} rows again, same session`);

    /* ---------- sign-out, then Back: no stale records from history ---------- */
    await open(nova, ROUTE);
    await nova.eval(`document.querySelector("[data-testid=session-badge] form button").click(); true`);
    const out = await nova.waitFor(`location.pathname === "/login" && location.search.includes("signedOut=1")`, 20000);
    await nova.eval(`history.back(); true`);
    await nova.waitFor(`location.pathname === ${JSON.stringify(ROUTE)}`, 20000);
    await nova.waitFor(`(() => { const s = ${STATE}; return s.refs.length === 0 && !!s.listError; })()`, 20000);
    s = await nova.eval(STATE);
    check("read-ui.sign-out-back", out && s.refs.length === 0 && s.listError?.kind === "session" && !(await hasNav(nova)) && leaks(s, all).length === 0,
      `signed out from the top bar, then Back to the list: "${s.listError?.text}" (${s.listError?.code}), no rows, no sidebar entry`);

    /* ---------- session expired: Keycloak session ended, access token lapses, refresh refused ---------- */
    const pixel = pages["pixel.applicant"];
    await open(pixel, ROUTE);
    const view = await pixel.eval(`fetch("/api/auth/session").then((r) => r.json())`);
    await totp.logoutUser(ids.name("pixel.applicant"));
    const waitMs = Math.max(0, new Date(view.accessExpiresAt).getTime() - Date.now() + 2000);
    console.log(`     waiting ${Math.round(waitMs / 1000)} s for PixelCert's access token to expire...`);
    await sleep(waitMs);
    await focus(pixel);
    await pixel.waitFor(`(() => { const s = ${STATE}; return s.refs.length === 0 && !!s.listError; })()`, 20000);
    s = await pixel.eval(STATE);
    const again = await open(pixel, ROUTE);
    check("read-ui.session-expired",
      s.listError?.kind === "session" && s.listError.code === "session_expired" && s.listError.signIn && s.refs.length === 0 && again.listError?.code === "no_session" && leaks(s, all).length === 0,
      `Keycloak session ended by admin, token expired, page left open: on the next revalidation the rows go and "${s.listError?.text}" (${s.listError?.code}) shows with a sign-in link; next load ${again.listError?.code}`);
    await pixel.screenshot(path.join(RUN_DIR, "read-ui-session-expired.png"));

    for (const p of Object.values(pages)) await p.close();
  } finally {
    await chrome.close();
  }
}

ids.withIdentities("test", main)
  .catch((e) => check("read-ui.run", false, `aborted: ${e.message}`))
  .then(() => {
    console.log(`read-ui checks: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });
