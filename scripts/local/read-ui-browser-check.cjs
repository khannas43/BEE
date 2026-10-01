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
 * The prototype only displays this screen when the development preview role is
 * manufacturer or agency (a display filter, not an access decision). The check picks
 * that preview to make the screen visible, and shows the preview never changes the data:
 * Nova previewing as agency sees the same rows, and the secretary and laboratory twins
 * previewing as manufacturer still get Spring's empty and forbidden answers.
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

const others = (all, org) => all.filter((a) => a.org !== org);
const leaks = (s, foreign) => foreign.filter((a) => s.body.includes(a.reference) || s.body.includes(a.id) || s.body.includes(a.model));

async function main() {
  if (!fs.existsSync(CHROME)) return check("read-ui.chrome", false, `Chrome not found at ${CHROME} (set BEE_CHROME)`);
  const all = applications();
  const chrome = await launchChrome();
  const pages = {};
  try {
    /* ---------- signed out: no record data, sign-in offered ---------- */
    const anon = await openPage(chrome.cdp);
    await anon.goto(`${WEB}/login`);
    await anon.waitFor(`location.pathname === "/login"`, 30000);
    await preview(anon, "manufacturer");
    let s = await open(anon, ROUTE);
    check("read-ui.signed-out", s.listError?.kind === "session" && s.listError.code === "no_session" && s.listError.signIn && s.refs.length === 0 && leaks(s, all).length === 0,
      `no session: list shows "${s.listError?.text}" (${s.listError?.code}) with a sign-in link; ${s.refs.length} rows; no record data`);
    await anon.close();

    for (const [persona, org, role] of [["nova.applicant", "NOVA", "manufacturer"], ["pixel.applicant", "PIXEL", "agency"]]) {
      const twin = ids.name(persona);
      await totp.ensureEnrolled(twin);
      const page = await openPage(chrome.cdp);
      pages[persona] = page;
      const ok = await signIn(page, twin);
      check(`read-ui.${persona}.signed-in`, ok, ok ? "Keycloak password + TOTP, portal session established" : "sign-in did not reach /app");
      if (!ok) continue;

      await preview(page, role);
      const own = all.filter((a) => a.org === org), foreign = others(all, org);
      const loading = await sawLoading(page, ROUTE, "[data-testid=model-applications-loading]");
      await page.waitFor(settled, 30000);
      s = await page.eval(STATE);
      check(`read-ui.${persona}.loading`, loading, `with a 1.5 s network delay, "Loading model applications…" was shown before the rows arrived`);
      const want = own.map((a) => a.reference).sort();
      check(`read-ui.${persona}.list`, JSON.stringify([...s.refs].sort()) === JSON.stringify(want) && s.body.includes(`${want.length} records`) && leaks(s, foreign).length === 0 && s.identity?.includes(org),
        `rows ${s.refs.join(", ")} = ${org}'s ${want.length} applications in bee_app; no other organisation's reference, id or model on screen; identity strip "${s.identity?.slice(0, 80)}"`);
      await page.screenshot(path.join(RUN_DIR, `read-ui-${persona}-list.png`));

      /* select a row: client navigation to ?id=, detail from its own GET */
      const pick = own[own.length - 1];
      await page.eval(`(() => { document.querySelector(${JSON.stringify(`[data-testid=model-app-open-${pick.reference}]`)}).click(); return true; })()`);
      await page.waitFor(`location.search === ${JSON.stringify(`?id=${pick.id}`)}`, 15000);
      await page.waitFor(detailSettled, 30000);
      s = await page.eval(STATE);
      check(`read-ui.${persona}.detail`, s.detail.Reference === pick.reference && s.detail.Organisation === org && s.detail["Record id"] === pick.id && s.detail["Model number"] === pick.model && leaks(s, foreign).length === 0,
        `clicked View on ${pick.reference}: detail panel shows reference ${s.detail.Reference}, organisation ${s.detail.Organisation}, model ${s.detail["Model number"]}, read basis ${s.detail["Read basis"]}`);
      await page.screenshot(path.join(RUN_DIR, `read-ui-${persona}-detail.png`));
      const detailLoading = await sawLoading(page, `${ROUTE}?id=${own[0].id}`, "Loading application");
      check(`read-ui.${persona}.detail-loading`, detailLoading, `opening ${own[0].reference} directly with a delayed network showed "Loading application…" first`);

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
        `${probes.map((p, i) => `${p[0]} (${p[0] === "cross-organisation" ? foreign[0].reference : p[1]})`).join(", ")}: identical "${seen[0].err?.text}"; no detail fields, no foreign data; list unchanged`);
      if (persona === "nova.applicant") await page.screenshot(path.join(RUN_DIR, "read-ui-nova.applicant-not-found.png"));
      const swapped = role === "manufacturer" ? "agency" : "manufacturer";
      await preview(page, swapped);
      s = await open(page, ROUTE);
      check(`read-ui.${persona}.preview-does-not-decide`, JSON.stringify([...s.refs].sort()) === JSON.stringify(want) && leaks(s, foreign).length === 0,
        `preview switched ${role} -> ${swapped}: still ${s.refs.join(", ")} (Spring scope by the signed-in identity, not the preview)`);
      await preview(page, role);
      check(`read-ui.${persona}.no-token-in-page`, s.cookie === "" && !/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(s.body), `document.cookie "${s.cookie}"; no JWT in the page text`);
    }

    /* ---------- empty and forbidden: real Spring answers for other personas ---------- */
    for (const [persona, testCase] of [["bee.secretary", "empty"], ["lab.officer", "forbidden"]]) {
      const twin = ids.name(persona);
      await totp.ensureEnrolled(twin);
      const page = await openPage(chrome.cdp);
      const ok = await signIn(page, twin);
      if (ok) await preview(page, "manufacturer");
      s = ok ? await open(page, ROUTE) : null;
      if (testCase === "empty") {
        const inStage = Number(sql("SELECT count(*) FROM app.model_application WHERE state = 'secretary_approval'"));
        check("read-ui.empty", ok && inStage === 0 && s.empty === "No model applications are available to you." && s.refs.length === 0 && s.body.includes("0 records") && leaks(s, all).length === 0,
          `secretary twin previewing as manufacturer (Spring: reads only secretary_approval; bee_app has ${inStage} such rows): "${s?.empty}", 0 records`);
        if (ok) await page.screenshot(path.join(RUN_DIR, "read-ui-empty.png"));
      } else {
        check("read-ui.forbidden", ok && s.listError?.kind === "forbidden" && s.listError.code === "no_read_scope" && leaks(s, all).length === 0,
          `laboratory twin previewing as manufacturer (Spring: no model-application read rule): "${s?.listError?.text}" (${s?.listError?.code}); no record data`);
      }
      await page.close();
    }

    /* ---------- service unavailable: Spring really stopped, then started again ---------- */
    const nova = pages["nova.applicant"], novaOwn = all.filter((a) => a.org === "NOVA");
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
      down.listError?.kind === "unavailable" && down.listError.text.includes(unreachable) && downDetail.detailError?.kind === "unavailable" && downDetail.detailError.text.includes(unreachable) && down.refs.length === 0 && back.refs.length === novaOwn.length,
      `Spring stopped: list "${down.listError?.text}", detail "${downDetail.detailError?.text}" (no rows, no stale data); Spring restarted: ${back.refs.length} rows again, same session`);

    /* ---------- session expired: Keycloak session ended, access token lapses, refresh refused ---------- */
    const pixel = pages["pixel.applicant"];
    const view = await pixel.eval(`fetch("/api/auth/session").then((r) => r.json())`);
    await totp.logoutUser(ids.name("pixel.applicant"));
    const waitMs = Math.max(0, new Date(view.accessExpiresAt).getTime() - Date.now() + 2000);
    console.log(`     waiting ${Math.round(waitMs / 1000)} s for PixelCert's access token to expire...`);
    await sleep(waitMs);
    s = await open(pixel, ROUTE);
    const again = await open(pixel, ROUTE);
    check("read-ui.session-expired",
      s.listError?.kind === "session" && s.listError.code === "session_expired" && s.listError.signIn && s.refs.length === 0 && again.listError?.code === "no_session" && leaks(s, all).length === 0,
      `Keycloak session ended by admin, token expired: "${s.listError?.text}" (${s.listError?.code}) with a sign-in link and no rows; next load ${again.listError?.code}`);
    await pixel.screenshot(path.join(RUN_DIR, "read-ui-session-expired.png"));

    await nova.eval(`fetch("/api/auth/logout", { method: "POST" }).then((r) => r.status)`);
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
