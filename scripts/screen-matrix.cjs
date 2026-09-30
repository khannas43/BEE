/* eslint-disable */
/**
 * WP01.2 screen/action matrix checks and report generator.
 * Fails (exit 1) on any matrix inconsistency. Reachability mismatches with the
 * current client policy are reported, not failed: each is a proposal for policy
 * review, never an automatic grant.
 */
const fs = require("fs");
const path = require("path");

const B = process.env.AA_BUILD;
if (!B) { console.error("Set AA_BUILD to the compiled config dir (use scripts/screen-matrix.sh)."); process.exit(2); }

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs/wp01/SCREEN_ACTION_MATRIX.md");
const WRITE = process.argv.includes("--write");

const { ROLES, ACCESS_CODES } = require(B + "/roles.js");
const { canRoleAccessPath, categoriesForRole, WORKFLOW_ACCESS } = require(B + "/categories.js");
const { ALL_SCREENS } = require(B + "/screens.js");
const {
  MATRIX, SLICE_STEPS, SLICE_SUBMITTERS, SLICE_FINAL_STATE, SLICE_RATING_ROW, SLICE_FEE_ROW,
  PROVISIONAL_DECISIONS, DEEP_KEYS_LIST, UNKNOWN_SPEC_KEYS, TASK_SOURCES, ENTRY_KEYS,
} = require(B + "/screenMatrix.js");

const ROLE_KEYS = ROLES.map((r) => r.key);
const INTERNAL = ROLES.filter((r) => r.kind === "internal").map((r) => r.key);
const PARTNERS = ROLES.filter((r) => r.kind === "external").map((r) => r.key);
const NONE = "—";
const codes = (cell) => (!cell || cell === NONE ? [] : cell.split("/"));

let failures = 0;
const fail = (msg) => { failures++; console.log("  ✗ " + msg); };
function check(name, fn) {
  const before = failures;
  fn();
  console.log((failures === before ? "✔ " : "✖ ") + name);
}

const byPath = new Map(MATRIX.map((r) => [r.path, r]));

/* ---------- routes that exist in the app directory ---------- */
function pageRoutes(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const seg = /^\(.*\)$/.test(e.name) ? "" : "/" + e.name;
      out.push(...pageRoutes(full, base + seg));
    } else if (e.name === "page.tsx") {
      out.push(base || "/");
    }
  }
  return out;
}
const APP_ROUTES = pageRoutes(path.join(ROOT, "app"), "").filter((r) => !r.includes("["));
const catalogueCount = ALL_SCREENS.length;

/* ---------- invariants ---------- */
check(`Every catalogue screen has exactly one row (${catalogueCount})`, () => {
  const cat = MATRIX.filter((r) => r.kind === "catalogue");
  if (cat.length !== catalogueCount) fail(`expected ${catalogueCount} catalogue rows, found ${cat.length}`);
  ALL_SCREENS.forEach((s) => {
    const p = `/app/${s.module}/${s.id}`;
    const n = MATRIX.filter((r) => r.path === p).length;
    if (n !== 1) fail(`${p} has ${n} rows`);
  });
  MATRIX.filter((r) => (r.note || "").startsWith("UNMAPPED")).forEach((r) => fail(`${r.path} has no matrix entry`));
  UNKNOWN_SPEC_KEYS.forEach((k) => fail(`matrix entry ${k} names no catalogue screen`));
});

check("Every static app route has a row, and every row path is a real route", () => {
  APP_ROUTES.forEach((r) => { if (!byPath.has(r)) fail(`route ${r} has no matrix row`); });
  MATRIX.filter((r) => r.kind !== "catalogue").forEach((r) => {
    if (!APP_ROUTES.includes(r.path)) fail(`row ${r.path} is not a route under app/`);
  });
});

check("Bespoke-screen list matches components/app/deepScreens.tsx", () => {
  const src = fs.readFileSync(path.join(ROOT, "components/app/deepScreens.tsx"), "utf8");
  const actual = [...src.matchAll(/"([a-z-]+\/[a-z0-9-]+)":/g)].map((m) => m[1]).sort();
  const listed = [...DEEP_KEYS_LIST].sort();
  actual.filter((k) => !listed.includes(k)).forEach((k) => fail(`${k} is bespoke but not in DEEP_KEYS_LIST`));
  listed.filter((k) => !actual.includes(k)).forEach((k) => fail(`${k} is in DEEP_KEYS_LIST but not bespoke`));
});

check("Merged, contextual and retired rows point at a retained row", () => {
  MATRIX.forEach((r) => {
    const needs = ["merge", "contextual", "retire"].includes(r.disposition);
    if (needs && !r.target) fail(`${r.path} (${r.disposition}) has no target`);
    if (!needs && r.target) fail(`${r.path} (${r.disposition}) should not have a target`);
    if (r.target) {
      const t = byPath.get(r.target);
      if (!t) fail(`${r.path} → ${r.target}: target has no row`);
      else if (t.disposition !== "retain") fail(`${r.path} → ${r.target}: target is ${t.disposition}, not retain`);
    }
  });
});

check("Capacity cells use only Annex A access codes", () => {
  MATRIX.forEach((r) => ROLE_KEYS.forEach((k) => codes(r.capacity[k]).forEach((c) => {
    if (!ACCESS_CODES[c]) fail(`${r.path} · ${k}: unknown code "${c}"`);
  })));
});

check("Internal capacity that differs from Annex A.1 carries a reason", () => {
  MATRIX.filter((r) => r.kind === "catalogue").forEach((r) => {
    const s = ALL_SCREENS.find((x) => `/app/${x.module}/${x.id}` === r.path);
    const diff = INTERNAL.filter((k) => (s.perms[k] ?? NONE) !== r.capacity[k]);
    if (diff.length && !r.why) fail(`${r.path}: ${diff.join(", ")} differ from Annex A.1 with no reason`);
  });
});

check("Partners never configure or approve, and never see all organisations", () => {
  MATRIX.forEach((r) => PARTNERS.forEach((k) => {
    const c = codes(r.capacity[k]);
    if (c.includes("G")) fail(`${r.path} · ${k} holds G (configure)`);
    if (c.includes("A")) fail(`${r.path} · ${k} holds A (approve)`);
    if (c.length && r.scope[k] === "all") fail(`${r.path} · ${k} has scope "all"`);
  }));
});

check("Every retained console row has at least one role with capacity", () => {
  MATRIX.filter((r) => r.disposition === "retain" && r.kind !== "public").forEach((r) => {
    if (!ROLE_KEYS.some((k) => r.capacity[k] !== NONE)) fail(`${r.path} is retained but no role can use it`);
  });
});

check("Browser-local or fixture state names the work package that replaces it", () => {
  const authoritative = ["lifecycle-store", "qr-store", "cert-store", "static-fixture"];
  MATRIX.filter((r) => authoritative.includes(r.state) && r.disposition !== "retire").forEach((r) => {
    if (!r.replacedBy) fail(`${r.path} reads ${r.state} but names no replacing work package`);
  });
});

check("Slice steps chain, and each actor holds the step's capacity", () => {
  SLICE_STEPS.forEach((st, i) => {
    const row = byPath.get(st.row);
    if (!row) return fail(`step ${st.n}: ${st.row} has no row`);
    if (!row.slice) fail(`step ${st.n}: ${st.row} is not tagged as slice`);
    if (!codes(row.capacity[st.actor]).includes(st.code)) fail(`step ${st.n}: ${st.actor} lacks ${st.code} on ${st.row} (has ${row.capacity[st.actor]})`);
    const next = SLICE_STEPS[i + 1];
    if (next && next.from !== st.to) fail(`step ${st.n} ends at ${st.to} but step ${next.n} starts at ${next.from}`);
  });
  const last = SLICE_STEPS[SLICE_STEPS.length - 1];
  if (last.to !== SLICE_FINAL_STATE) fail(`slice must end at ${SLICE_FINAL_STATE}, ends at ${last.to}`);
  if (SLICE_STEPS.some((s) => s.from === SLICE_FINAL_STATE)) fail(`no slice step may start from the final state ${SLICE_FINAL_STATE}`);
});

check("Rating is computed and versioned before final approval, and both approvers can read it", () => {
  const i = SLICE_STEPS.findIndex((s) => s.row === SLICE_RATING_ROW);
  if (i < 0) return fail("no rating step");
  const st = SLICE_STEPS[i];
  if (st.code !== "X") fail(`rating step needs X, has ${st.code}`);
  if (!/version/i.test(st.records || "")) fail("rating step must record the formula version");
  const approvals = SLICE_STEPS.map((s, j) => ({ s, j })).filter(({ s }) => s.code === "A");
  if (!approvals.length) fail("no approval steps");
  approvals.forEach(({ s, j }) => {
    if (j < i) fail(`step ${s.n} (${s.actor} approve) comes before the rating is computed`);
    if (!codes(byPath.get(SLICE_RATING_ROW).capacity[s.actor]).includes("V")) fail(`${s.actor} cannot view the rating on ${SLICE_RATING_ROW}`);
    if (!codes(byPath.get(s.row).capacity[s.actor]).includes("V")) fail(`${s.actor} cannot view ${s.row}`);
  });
});

check("Manual fee confirmation is a Finance execute (X) step, with no payer confirm", () => {
  const fee = SLICE_STEPS.filter((s) => s.row === SLICE_FEE_ROW);
  if (fee.length !== 1) return fail(`expected one fee step, found ${fee.length}`);
  if (fee[0].actor !== "finance") fail(`fee confirmation belongs to ${fee[0].actor}, not finance`);
  if (fee[0].code !== "X") fail(`fee confirmation needs X, has ${fee[0].code}`);
  if (!fee[0].manual) fail("fee step must be marked manual");
  const row = byPath.get(SLICE_FEE_ROW);
  ROLE_KEYS.forEach((k) => {
    const c = codes(row.capacity[k]);
    if (c.includes("A")) fail(`${k} holds A on ${SLICE_FEE_ROW}; fee confirmation is not an approval`);
    if (c.includes("X") && k !== "finance") fail(`${k} holds X on ${SLICE_FEE_ROW}; only Finance confirms`);
  });
  MATRIX.filter((r) => r.path === SLICE_FEE_ROW || r.target === SLICE_FEE_ROW).forEach((r) =>
    SLICE_SUBMITTERS.forEach((k) => {
      const c = codes(r.capacity[k]);
      if (c.includes("A") || c.includes("X")) fail(`payer ${k} holds ${r.capacity[k]} on ${r.path}`);
    }));
});

check("Maker-checker holds on the slice", () => {
  const sliceRows = MATRIX.filter((r) => r.slice);
  sliceRows.forEach((r) => SLICE_SUBMITTERS.forEach((k) => {
    const c = codes(r.capacity[k]);
    if (c.includes("A") || c.includes("X")) fail(`submitter ${k} holds ${r.capacity[k]} on ${r.path}`);
  }));
  const actors = SLICE_STEPS.filter((s) => ["A", "X", "R"].includes(s.code)).map((s) => s.actor);
  if (new Set(actors).size !== actors.length) fail(`one role acts at two decision steps: ${actors.join(", ")}`);
  const approvers = SLICE_STEPS.filter((s) => s.code === "A" && s.row.endsWith("director-approval")).map((s) => s.actor);
  if (new Set(approvers).size !== approvers.length || approvers.length < 2) fail(`approval needs two distinct approvers, found ${approvers.join(", ")}`);
  MATRIX.forEach((r) => { if (codes(r.capacity.iame).includes("A")) fail(`IAME holds final approval on ${r.path}`); });
});

check("On slice step rows, only the step owner holds approve (A) or execute (X)", () => {
  const stepRows = new Set(SLICE_STEPS.map((s) => s.row));
  MATRIX.filter((r) => r.slice).forEach((r) => {
    ["A", "X"].forEach((code) => {
      const onStepRow = stepRows.has(r.path) || stepRows.has(r.target);
      if (code === "X" && !onStepRow) return;
      const owners = new Set(SLICE_STEPS.filter((s) => s.code === code && (s.row === r.path || s.row === r.target)).map((s) => s.actor));
      ROLE_KEYS.forEach((k) => {
        if (codes(r.capacity[k]).includes(code) && !owners.has(k)) fail(`${k} holds ${code} on ${r.path} but owns no ${code} step there`);
      });
    });
  });
});

check("Local-demo defaults are recorded as provisional BEE decisions", () => {
  if (PROVISIONAL_DECISIONS.length !== 6) fail(`expected 6 provisional decisions, found ${PROVISIONAL_DECISIONS.length}`);
  PROVISIONAL_DECISIONS.forEach((d) => {
    if (d.status !== "provisional, pending BEE decision") fail(`${d.id} is not marked provisional`);
    if (!d.question || !d.provisional || !d.basis) fail(`${d.id} is missing a question, default or basis`);
  });
});

/* ---------- planned entry paths for retained console routes ---------- */
function entryOf(r) { return r.disposition === "retain" || r.disposition === "dev-only" ? r.path : r.target; }
const isConsole = (p) => p && p.startsWith("/app");
const MENUS = Object.fromEntries(ROLE_KEYS.map((k) => {
  const m = new Map();
  categoriesForRole(k).forEach((c) => c.items.forEach((i) => m.set(i.href.split("?")[0], `${c.label} › ${i.label}`)));
  return [k, m];
}));
const menuHrefs = (k) => new Set(MENUS[k].keys());
const retainedConsole = MATRIX.filter((r) => r.disposition === "retain" && isConsole(r.path));
const has = (r, k) => r && r.capacity[k] !== NONE;

/** Resolve how role k reaches retained route p. Returns { ok, kind, via, reason }. */
function resolve(k, p, seen = new Set()) {
  const row = byPath.get(p);
  if (MENUS[k].has(p)) return { ok: true, kind: "menu (current)", via: MENUS[k].get(p) };
  const e = row && row.entry[k];
  if (!e) return { ok: false, reason: "no planned entry path" };
  if (seen.has(p)) return { ok: false, reason: `entry cycle through ${p}` };
  seen = new Set([...seen, p]);
  if (e.kind === "menu") return e.label ? { ok: true, kind: "menu (planned)", via: e.label } : { ok: false, reason: "planned menu item has no label" };
  const parent = e.kind === "task" ? e.source : e.parent;
  const label = e.kind === "task" ? e.task : e.action;
  if (!label) return { ok: false, reason: `${e.kind} entry has no description` };
  if (parent === p) return { ok: false, reason: "entry points at itself" };
  if (e.kind === "task" && !TASK_SOURCES.includes(parent)) return { ok: false, reason: `${parent} is not a task source` };
  const pr = byPath.get(parent);
  if (!pr || pr.disposition !== "retain" || !isConsole(parent)) return { ok: false, reason: `${parent} is not a retained console route` };
  if (!has(pr, k)) return { ok: false, reason: `${k} has no capacity on ${parent}` };
  const up = resolve(k, parent, seen);
  if (!up.ok) return { ok: false, reason: `${parent}: ${up.reason}` };
  return { ok: true, kind: e.kind === "task" ? "task link" : "contextual", via: `\`${parent}\` › ${label}` };
}

const entryRows = [];
check("Every permitted role on every retained console route has a planned entry path", () => {
  retainedConsole.forEach((r) => ROLE_KEYS.forEach((k) => {
    if (!has(r, k)) {
      if (r.entry[k]) fail(`${r.path} · ${k}: entry path recorded for a role with no capacity`);
      return;
    }
    const res = resolve(k, r.path);
    if (!res.ok) return fail(`${r.path} · ${k}: ${res.reason}`);
    entryRows.push({ path: r.path, role: k, kind: res.kind, via: res.via, guard: canRoleAccessPath(k, r.path), slice: !!r.slice });
  }));
  const retainedPaths = new Set(retainedConsole.map((r) => r.path));
  ENTRY_KEYS().forEach((p) => { if (!retainedPaths.has(p)) fail(`entry paths recorded for ${p}, which is not a retained console route`); });
  MATRIX.filter((r) => r.disposition !== "retain").forEach((r) => {
    if (Object.keys(r.entry).length) fail(`${r.path} (${r.disposition}) has entry paths; only retained routes are entered directly`);
  });
});

/* ---------- report: reachability under the current client policy ---------- */

const gaps = [];
MATRIX.forEach((r) => {
  const entry = entryOf(r);
  if (!isConsole(entry) || r.disposition === "retire") return;
  ROLE_KEYS.forEach((k) => {
    if (r.capacity[k] === NONE) return;
    if (canRoleAccessPath(k, entry)) return;
    const annex = r.kind === "catalogue" && INTERNAL.includes(k) &&
      (ALL_SCREENS.find((x) => `/app/${x.module}/${x.id}` === r.path).perms[k] ?? NONE) === r.capacity[k];
    gaps.push({ path: r.path, entry, role: k, cap: r.capacity[k], slice: !!r.slice, source: annex ? "Annex A.1 cell" : "WP01 proposal" });
  });
});

const sliceReach = SLICE_STEPS.map((s) => ({ ...s, allowed: canRoleAccessPath(s.actor, s.row), inMenu: menuHrefs(s.actor).has(s.row) }));

const deviations = MATRIX.filter((r) => r.kind === "catalogue" && r.why);

/* ---------- markdown ---------- */
const SHORT = { admin: "Adm", programme: "Prg", reviewer: "Rev", director: "Dir", secretary: "Sec", finance: "Fin", helpdesk: "HD", auditor: "Aud", manufacturer: "Mfr", agency: "Agy", iame: "IAME", sda: "SDA", laboratory: "Lab" };
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|");
const count = (f) => MATRIX.filter(f).length;
const WS = [
  ["home", "Home"], ["work", "My work and approvals"], ["registrations", "Registrations"], ["labels", "Labels, QR and certificates"],
  ["production-finance", "Production and finance"], ["enforcement", "Enforcement"], ["support", "Support"],
  ["insights-admin", "Insights and administration"], ["public", "Public (no login)"], ["dev", "Development only"],
];
const DISP = ["retain", "merge", "contextual", "retire", "dev-only"];
const defaultScope = (k) => (INTERNAL.includes(k) ? "all" : k === "manufacturer" || k === "agency" ? "own-org" : "assigned");

const L = [];
L.push("# WP01.2 Screen and role/action matrix");
L.push("");
L.push("Generated by `bash scripts/screen-matrix.sh --write` from `lib/screenMatrix.ts`. Do not edit by hand.");
L.push("Status: WP01.1–WP01.3 passed documentation review on 30 September 2026. WP01 is accepted as documentation and design evidence (1 of 11 work packages, 9.1%). The 540 policy-review proposals below remain proposals; none is granted. The running app does not read this matrix, and no route or menu has changed.");
L.push("");
L.push("## Summary");
L.push("");
L.push(`Rows: ${MATRIX.length} (${count((r) => r.kind === "catalogue")} catalogue screens, ${count((r) => r.kind === "standalone")} standalone console routes, ${count((r) => r.kind === "public")} public routes).`);
L.push("");
L.push("| Disposition | Catalogue | Standalone | Public |");
L.push("| --- | ---: | ---: | ---: |");
DISP.forEach((d) => L.push(`| ${d} | ${count((r) => r.kind === "catalogue" && r.disposition === d)} | ${count((r) => r.kind === "standalone" && r.disposition === d)} | ${count((r) => r.kind === "public" && r.disposition === d)} |`));
L.push("");
L.push(`Retained console entry routes: ${count((r) => r.disposition === "retain" && isConsole(r.path))}. Bespoke catalogue screens: ${count((r) => r.impl === "deep")}; generic placeholder screens: ${count((r) => r.impl === "scaffold")}.`);
L.push("");
L.push("## Legend");
L.push("");
L.push("Capacity codes (Annex A): " + Object.entries(ACCESS_CODES).map(([k, v]) => `**${k}** ${v}`).join(", ") + ". **—** means no access.");
L.push("");
L.push("Default data scope: internal roles see all records; Manufacturer and Agency see their own organisation; IAME, SDA and Laboratory see assigned work. The Scope column lists only exceptions.");
L.push("");
L.push("Dispositions: **retain** is an entry route; **merge** folds into another route; **contextual** becomes a tab, panel or action inside a retained route; **retire** is removed in favour of the target; **dev-only** is hidden outside development.");
L.push("");
L.push("Internal capacity is the Annex A.1 cell unless the row appears under Annex A.1 deviations. Partner capacity is proposed here: DDD Annex A.2 gives all five partner roles identical cells on every row, so it cannot be used unchanged.");
L.push("");
L.push("## First registration-to-model slice");
L.push("");
L.push("| Step | Actor | Action | Needs | Route | State | Guard allows today | In actor's menu |");
L.push("| ---: | --- | --- | --- | --- | --- | --- | --- |");
sliceReach.forEach((s) => L.push(`| ${s.n} | ${SHORT[s.actor]} | ${esc(s.action)}${s.manual ? ". " + esc(s.manual) : ""}${s.records ? ` Records: ${esc(s.records)}.` : ""} | ${s.code} | \`${s.row}\` | ${s.from} → ${s.to} | ${s.allowed ? "yes" : "**no**"} | ${s.inMenu ? "yes" : "no (task link)"} |`));
L.push("");
L.push(`Final slice state: **${SLICE_FINAL_STATE}**. The rating is computed and versioned before the Director and Secretary decide.`);
L.push("");
L.push("## Provisional BEE decisions used by the local demo");
L.push("");
L.push("These are defaults so the local slice can run. None is a BEE decision until BEE confirms it.");
L.push("");
L.push("| ID | Question | Provisional default | Basis | Status |");
L.push("| --- | --- | --- | --- | --- |");
PROVISIONAL_DECISIONS.forEach((d) => L.push(`| ${d.id} | ${esc(d.question)} | ${esc(d.provisional)} | ${esc(d.basis)} | ${d.status} |`));
L.push("");
L.push(`## Reachability mismatches: proposals requiring policy review (${gaps.length})`);
L.push("");
L.push("Each entry is a role that holds capacity on a row in this matrix, while `canRoleAccessPath` in `lib/categories.ts` denies the row's entry route today.");
L.push("");
L.push("**None of these is a grant.** The current policy stays in force, and no mismatch may be closed by widening a menu, the route guard or a server permission automatically. Each one is a proposal for a policy review (WP02 and the owning workspace work package), which must accept or reject it individually. A rejected proposal is resolved by removing the capacity from this matrix instead.");
L.push("");
L.push("Basis: an **Annex A.1 cell** is an internal cell carried unchanged from `lib/screens.ts`, showing how much broader Annex A.1 is than the implemented policy. A **WP01 proposal** is capacity set in this matrix.");
L.push("");
L.push("| Role | Annex A.1 cell | WP01 proposal | On slice rows |");
L.push("| --- | ---: | ---: | ---: |");
ROLE_KEYS.forEach((k) => {
  const g = gaps.filter((x) => x.role === k);
  if (g.length) L.push(`| ${SHORT[k]} | ${g.filter((x) => x.source === "Annex A.1 cell").length} | ${g.filter((x) => x.source === "WP01 proposal").length} | ${g.filter((x) => x.slice).length} |`);
});
L.push(`| **Total** | **${gaps.filter((x) => x.source === "Annex A.1 cell").length}** | **${gaps.filter((x) => x.source === "WP01 proposal").length}** | **${gaps.filter((x) => x.slice).length}** |`);
L.push("");
const gapTable = (list) => {
  L.push("| Row | Entry route | Role | Proposed capacity | Basis | Status |");
  L.push("| --- | --- | --- | --- | --- | --- |");
  list.forEach((g) => L.push(`| \`${g.path}\` | \`${g.entry}\` | ${SHORT[g.role]} | ${g.cap} | ${g.source} | needs policy review |`));
};
L.push("### Proposals on slice rows");
L.push("");
const sliceGaps = gaps.filter((g) => g.slice);
if (sliceGaps.length) gapTable(sliceGaps); else L.push("None.");
L.push("");
L.push("### All other proposals");
L.push("");
L.push("<details><summary>" + gaps.filter((g) => !g.slice).length + " rows</summary>");
L.push("");
gapTable(gaps.filter((g) => !g.slice));
L.push("");
L.push("</details>");
L.push("");
const KINDS = ["menu (current)", "menu (planned)", "task link", "contextual"];
L.push(`## Planned entry paths for retained console routes (${entryRows.length} role/route pairs)`);
L.push("");
L.push("Every role with capacity on a retained console route has one planned entry path: its current menu item, a planned menu item, a task link from an inbox or queue, or a contextual action on a parent route that the role can itself reach and use. Being the target of merged screens does not count as an entry path, and the check fails if any permitted role has none.");
L.push("");
L.push("Planned menu items, task links and contextual actions that the current client policy denies are part of the policy-review proposals below. Recording an entry path grants nothing.");
L.push("");
L.push("| Entry kind | Pairs | Guard allows today | Guard denies today |");
L.push("| --- | ---: | ---: | ---: |");
KINDS.forEach((kd) => {
  const e = entryRows.filter((x) => x.kind === kd);
  L.push(`| ${kd} | ${e.length} | ${e.filter((x) => x.guard).length} | ${e.filter((x) => !x.guard).length} |`);
});
L.push(`| **Total** | **${entryRows.length}** | **${entryRows.filter((x) => x.guard).length}** | **${entryRows.filter((x) => !x.guard).length}** |`);
L.push("");
L.push("Specific resolutions: `/app/administration/admin-dashboard` is entered by Admin from the admin home (`/app`) tile; `/app/documents/malware-quarantine` is entered only from the document repository (`/app/documents/repository`), which is itself entered from Admin's planned Documents menu item, the model record Documents tab or the audit evidence view.");
L.push("");
L.push("<details><summary>Entry paths not covered by the current menu (" + entryRows.filter((x) => x.kind !== "menu (current)").length + " pairs)</summary>");
L.push("");
L.push("| Route | Role | Entry kind | Via | Guard today |");
L.push("| --- | --- | --- | --- | --- |");
entryRows.filter((x) => x.kind !== "menu (current)").forEach((x) =>
  L.push(`| \`${x.path}\` | ${SHORT[x.role]} | ${x.kind} | ${esc(x.via)} | ${x.guard ? "allows" : "denies (proposal)"} |`));
L.push("");
L.push("</details>");
L.push("");
L.push(`## Annex A.1 deviations (${deviations.length})`);
L.push("");
L.push("| Row | Annex A.1 (internal) | Proposed (internal) | Reason |");
L.push("| --- | --- | --- | --- |");
deviations.forEach((r) => {
  const s = ALL_SCREENS.find((x) => `/app/${x.module}/${x.id}` === r.path);
  const fmt = (get) => INTERNAL.map((k) => `${SHORT[k]} ${get(k)}`).join(" · ");
  L.push(`| \`${r.path}\` | ${fmt((k) => s.perms[k] ?? NONE)} | ${fmt((k) => r.capacity[k])} | ${esc(r.why)} |`);
});
L.push("");
L.push("## Matrix by workspace");
WS.forEach(([id, title]) => {
  const rows = MATRIX.filter((r) => r.workspace === id);
  if (!rows.length) return;
  L.push("");
  L.push(`### ${title} (${rows.length})`);
  L.push("");
  L.push("| Route | Screen | Disposition | Impl / state | " + ROLE_KEYS.map((k) => SHORT[k]).join(" | ") + " | Scope | Notes |");
  L.push("| --- | --- | --- | --- | " + ROLE_KEYS.map(() => "---").join(" | ") + " | --- | --- |");
  rows.forEach((r) => {
    const disp = r.target ? `${r.disposition} → \`${r.target}\`${r.via ? ` (${esc(r.via)})` : ""}` : r.disposition;
    const st = `${r.impl} / ${r.state}${r.replacedBy ? ` → ${r.replacedBy}` : ""}`;
    const scope = Object.entries(r.scope).filter(([k, v]) => v !== defaultScope(k)).map(([k, v]) => `${SHORT[k]} ${v}`).join(", ");
    const notes = [r.slice ? "**slice**" : "", esc(r.note)].filter(Boolean).join(" ");
    L.push(`| \`${r.path}\` | ${esc(r.name)} | ${disp} | ${st} | ` + ROLE_KEYS.map((k) => r.capacity[k]).join(" | ") + ` | ${scope} | ${notes} |`);
  });
});
L.push("");
const md = L.join("\n");

/* ---------- WP01.3 acceptance mapping (structure only, not business acceptance) ---------- */
const { ACCEPTANCE_ITEMS: AI_ITEMS, REQUIREMENTS, API_ENDPOINTS } = require(B + "/acceptanceMap.js");
const AM_OUT = path.join(ROOT, "docs/wp01/ACCEPTANCE_MAPPING.md");
const readDoc = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const section = (text, n) => {
  const m = text.split(/\n(?=## )/).find((s) => s.startsWith(`## ${n}.`));
  return m || "";
};
const SLICE_DOC = readDoc("docs/wp01/FIRST_SLICE.md");
const PLAN_ACTIVITIES = [...readDoc("docs/DEVELOPMENT_PLAN.md").matchAll(/^\| (WP\d\d\.\d) \|/gm)].map((m) => m[1]);
const INVENTORY_REQS = [...section(readDoc("docs/wp01/INVENTORY.md"), 4).matchAll(/^\| (R\d+) \|/gm)].map((m) => m[1]);
const numbered = (text) => [...text.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
const DENIALS_IN_DOC = numbered(section(SLICE_DOC, 8));
const CHECKS_IN_DOC = numbered(section(SLICE_DOC, 9));
const ENTITIES_IN_DOC = [...section(SLICE_DOC, 6).matchAll(/^\| `([a-z_]+)` \|/gm)].map((m) => m[1]);
const API_SECTION = section(SLICE_DOC, 7);
const reqIds = REQUIREMENTS.map((r) => r.id);
const reqById = new Map(REQUIREMENTS.map((r) => [r.id, r]));
const isWp01 = (a) => a.startsWith("WP01.");

check("Acceptance map: item IDs are unique and owners are planned activities", () => {
  const seen = new Set();
  AI_ITEMS.forEach((it) => {
    if (seen.has(it.id)) fail(`duplicate item ${it.id}`);
    seen.add(it.id);
    if (!PLAN_ACTIVITIES.includes(it.owner)) fail(`${it.id}: owner ${it.owner} is not an activity in DEVELOPMENT_PLAN.md §15.2`);
    if (!it.title || !it.check) fail(`${it.id}: missing title or check`);
  });
  REQUIREMENTS.forEach((r) => (r.deferred || []).forEach((d) => {
    if (!PLAN_ACTIVITIES.includes(d.owner)) fail(`${r.id}: deferred owner ${d.owner} is not a planned activity`);
  }));
});

check("Acceptance map: WP01 document evidence is separate from future application checks", () => {
  AI_ITEMS.forEach((it) => {
    if (it.evidence === "wp01-document") {
      if (!isWp01(it.owner)) fail(`${it.id}: WP01 document evidence owned by ${it.owner}`);
      if (!["document-review", "structure-script"].includes(it.checkType)) fail(`${it.id}: document evidence uses check type ${it.checkType}`);
      if (!["passed-documentation-review", "pending-documentation-review"].includes(it.status)) fail(`${it.id}: document evidence has status ${it.status}`);
    } else if (it.evidence === "future-application-check") {
      if (isWp01(it.owner)) fail(`${it.id}: future application check owned by WP01`);
      if (["document-review", "structure-script"].includes(it.checkType)) fail(`${it.id}: future check uses a document check type`);
      if (it.status !== "not-started") fail(`${it.id}: future application check has status ${it.status}; only not-started is allowed in WP01`);
      if (it.blocksWp01) fail(`${it.id}: a future application check must not block WP01`);
    } else fail(`${it.id}: unknown evidence ${it.evidence}`);
    if (/accept/i.test(it.status)) fail(`${it.id}: status ${it.status} claims acceptance`);
  });
  const blockers = AI_ITEMS.filter((i) => i.blocksWp01);
  if (!blockers.length) fail("no WP01 exit criteria recorded");
  blockers.forEach((it) => { if (it.evidence !== "wp01-document") fail(`${it.id} blocks WP01 but is not WP01 document evidence`); });
});

check("Acceptance map: runtime proof belongs to WP03 and WP01 exits on the documented contract", () => {
  const rt = AI_ITEMS.filter((i) => i.kind === "runtime");
  if (rt.length !== 1) fail(`expected one runtime item, found ${rt.length}`);
  rt.forEach((it) => {
    if (!it.owner.startsWith("WP03.")) fail(`${it.id}: runtime proof owned by ${it.owner}, not WP03`);
    if (it.blocksWp01) fail(`${it.id}: runtime proof must not block WP01`);
  });
  const contract = AI_ITEMS.filter((i) => i.kind === "exit" && /command contract documented/i.test(i.title));
  if (contract.length !== 1) fail("WP01 exit criteria must include the documented runtime command contract");
  AI_ITEMS.filter((i) => i.blocksWp01).forEach((it) => {
    if (/starts reproducibly/i.test(it.title)) fail(`${it.id}: "starts reproducibly" cannot be a WP01 exit criterion`);
  });
});

check("Acceptance map: every slice step, acceptance check and denial case in FIRST_SLICE.md is mapped once", () => {
  const steps = AI_ITEMS.filter((i) => i.kind === "step");
  SLICE_STEPS.forEach((s) => {
    const m = steps.filter((i) => i.step === s.n);
    if (m.length !== 1) fail(`slice step ${s.n} has ${m.length} mapped items`);
  });
  steps.forEach((i) => { if (!SLICE_STEPS.some((s) => s.n === i.step)) fail(`${i.id}: step ${i.step} is not a slice step`); });
  const same = (kind, doc, label) => {
    const refs = AI_ITEMS.filter((i) => i.kind === kind).map((i) => i.ref).sort((a, b) => a - b);
    if (!doc.length) fail(`FIRST_SLICE.md has no numbered ${label}`);
    if (JSON.stringify(refs) !== JSON.stringify(doc)) fail(`${label}: map has [${refs}], FIRST_SLICE.md has [${doc}]`);
  };
  same("denial", DENIALS_IN_DOC, "denial cases (§8)");
  same("acceptance", CHECKS_IN_DOC, "acceptance checks (§9)");
});

check("Acceptance map: API endpoints and records match FIRST_SLICE.md", () => {
  API_ENDPOINTS.forEach((e) => { if (!API_SECTION.includes("`" + e + "`")) fail(`endpoint ${e} is not in FIRST_SLICE.md §7`); });
  AI_ITEMS.forEach((it) => {
    (it.api || []).forEach((e) => { if (!API_ENDPOINTS.includes(e)) fail(`${it.id}: unknown endpoint ${e}`); });
    (it.records || []).forEach((r) => { if (!ENTITIES_IN_DOC.includes(r)) fail(`${it.id}: record ${r} is not in FIRST_SLICE.md §6`); });
    if (it.evidence === "future-application-check" && it.checkType === "api" && !(it.api || []).length) fail(`${it.id}: API check names no endpoint`);
  });
});

check("Acceptance map: R1–R15 are traced, and requirements outside the slice are deferred, not claimed", () => {
  const expected = Array.from({ length: 15 }, (_, i) => `R${i + 1}`);
  if (JSON.stringify(reqIds) !== JSON.stringify(expected)) fail(`requirements are [${reqIds}], expected R1–R15`);
  if (JSON.stringify(INVENTORY_REQS) !== JSON.stringify(expected)) fail(`INVENTORY.md §4 lists [${INVENTORY_REQS}]`);
  REQUIREMENTS.forEach((r) => {
    const d = r.deferred || [];
    if (r.coverage === "slice" && (!r.inSlice || d.length)) fail(`${r.id}: slice coverage needs inSlice and no deferred parts`);
    if (r.coverage === "partial" && (!r.inSlice || !d.length)) fail(`${r.id}: partial coverage needs inSlice and at least one deferred part`);
    if (r.coverage === "deferred" && (r.inSlice || !d.length)) fail(`${r.id}: deferred coverage needs an owner and no inSlice claim`);
    d.forEach((x) => { if (isWp01(x.owner)) fail(`${r.id}: deferred to WP01`); });
  });
  const future = AI_ITEMS.filter((i) => i.evidence === "future-application-check");
  AI_ITEMS.forEach((it) => it.requirements.forEach((id) => {
    if (!reqById.has(id)) fail(`${it.id}: unknown requirement ${id}`);
    else if (reqById.get(id).coverage === "deferred" && it.evidence === "future-application-check") fail(`${it.id}: slice check claims deferred requirement ${id}`);
  }));
  REQUIREMENTS.filter((r) => r.coverage !== "deferred").forEach((r) => {
    if (!future.some((i) => i.requirements.includes(r.id))) fail(`${r.id} is in the slice but no future application check covers it`);
  });
});

/* ---------- acceptance mapping document ---------- */
const A = [];
const STATUS = { "passed-documentation-review": "passed documentation review", "pending-documentation-review": "pending documentation review", "not-started": "not started" };
A.push("# WP01.3 Acceptance mapping");
A.push("");
A.push("Generated by `bash scripts/screen-matrix.sh --write` from `lib/acceptanceMap.ts`. Do not edit by hand.");
A.push("");
A.push("Status: WP01.3 passed documentation review on 30 September 2026. WP01 is accepted as documentation and design evidence (1 of 11 work packages, 9.1%). Future application checks remain not started.");
A.push("");
A.push("The machine checks on this mapping validate its **structure** (every step, acceptance check, denial case and requirement is mapped; owners are planned activities; WP01 document evidence is kept apart from future application checks; nothing claims acceptance). They are **not business acceptance**, and a green result does not mean any behaviour below exists.");
A.push("");
A.push("## WP01 exit criteria");
A.push("");
A.push("\"Local runtime starts reproducibly\" is replaced as a WP01 exit criterion by \"local runtime architecture, resource budget and start/seed/reset/check command contract documented\" ([ADR-001](ADR-001-local-runtime.md)). The executable start and health proof is item RT1, owned by WP03, and does not block WP01.");
A.push("");
A.push("| ID | Criterion | Owner | Evidence | Check | Status |");
A.push("| --- | --- | --- | --- | --- | --- |");
AI_ITEMS.filter((i) => i.blocksWp01).forEach((i) => A.push(`| ${i.id} | ${esc(i.title)}${i.note ? `. ${esc(i.note)}` : ""} | ${i.owner} | WP01 document (${i.checkType}) | ${esc(i.check)} | ${STATUS[i.status]} |`));
A.push("");
A.push("## Requirement trace R1–R15");
A.push("");
A.push("**Slice**: the first slice demonstrates it. **Partial**: the slice demonstrates the part stated; the rest is deferred. **Deferred**: not in the slice; owned by the listed activity.");
A.push("");
A.push("| ID | Requirement | Coverage | In the first slice | Deferred to | Future checks |");
A.push("| --- | --- | --- | --- | --- | --- |");
REQUIREMENTS.forEach((r) => {
  const checks = AI_ITEMS.filter((i) => i.evidence === "future-application-check" && i.requirements.includes(r.id)).map((i) => i.id);
  const def = (r.deferred || []).map((d) => `${d.owner}: ${esc(d.part)}`).join("; ") || "—";
  A.push(`| ${r.id} | ${esc(r.summary)} | ${r.coverage} | ${esc(r.inSlice || "—")} | ${def} | ${checks.join(", ") || "—"} |`);
});
A.push("");
const futureTable = (kind, title, refLabel) => {
  const rows = AI_ITEMS.filter((i) => i.kind === kind);
  A.push(`## ${title} (${rows.length})`);
  A.push("");
  A.push(`| ID | ${refLabel} | Check | Requirements | Owner | Type | API | Records | Status |`);
  A.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  rows.forEach((i) => A.push(`| ${i.id} | ${esc(i.title)}${i.note ? `. ${esc(i.note)}` : ""} | ${esc(i.check)} | ${i.requirements.join(", ") || "—"} | ${i.owner} | ${i.checkType} | ${(i.api || []).map((e) => "`" + e + "`").join("<br>") || "—"} | ${(i.records || []).join(", ") || "—"} | ${STATUS[i.status]} |`));
  A.push("");
};
A.push("The sections below are **future application checks**. None exists yet; each is to be built and run by its owning activity.");
A.push("");
futureTable("step", "Slice steps", "Step");
futureTable("acceptance", "Proposed acceptance checks (FIRST_SLICE.md §9)", "Check");
futureTable("denial", "Denial cases (FIRST_SLICE.md §8)", "Denial");
futureTable("runtime", "Runtime proof", "Proof");
A.push("## Future checks by owner");
A.push("");
A.push("| Owner | Items |");
A.push("| --- | --- |");
[...new Set(AI_ITEMS.filter((i) => i.evidence === "future-application-check").map((i) => i.owner))].sort().forEach((o) =>
  A.push(`| ${o} | ${AI_ITEMS.filter((i) => i.owner === o && i.evidence === "future-application-check").map((i) => i.id).join(", ")} |`));
A.push("");
A.push("Authorisation for these checks is limited to the reviewed first-slice rules (ADR-001 D-RT4). No capacity is imported from the screen matrix; its 540 reachability mismatches remain proposals for policy review.");
A.push("");
const amd = A.join("\n");

check("Generated acceptance mapping document is current", () => {
  if (WRITE) { fs.writeFileSync(AM_OUT, amd); return; }
  if (!fs.existsSync(AM_OUT)) return fail(`${path.relative(ROOT, AM_OUT)} is missing (run with --write)`);
  if (fs.readFileSync(AM_OUT, "utf8") !== amd) fail(`${path.relative(ROOT, AM_OUT)} is stale (run with --write)`);
});

check("Generated matrix document is current", () => {
  if (WRITE) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, md); return; }
  if (!fs.existsSync(OUT)) return fail(`${path.relative(ROOT, OUT)} is missing (run with --write)`);
  if (fs.readFileSync(OUT, "utf8") !== md) fail(`${path.relative(ROOT, OUT)} is stale (run with --write)`);
});

console.log(`\nRows: ${MATRIX.length} · Retained console entries: ${count((r) => r.disposition === "retain" && isConsole(r.path))} · Reachability mismatches (proposals for policy review, not grants): ${gaps.length} (slice rows: ${gaps.filter((g) => g.slice).length}) · Annex A.1 deviations: ${deviations.length}`);
console.log(`Acceptance map: ${AI_ITEMS.length} items (${AI_ITEMS.filter((i) => i.evidence === "wp01-document").length} WP01 document evidence, ${AI_ITEMS.filter((i) => i.evidence !== "wp01-document").length} future application checks, not started) · Requirements: ${REQUIREMENTS.length} (${["slice", "partial", "deferred"].map((c) => `${REQUIREMENTS.filter((r) => r.coverage === c).length} ${c}`).join(", ")}). Structure checks only; not business acceptance.`);
if (failures) { console.log(`\nFAILED — ${failures} violation(s).`); process.exit(1); }
console.log(WRITE ? `\nPASSED — wrote ${path.relative(ROOT, OUT)} and ${path.relative(ROOT, AM_OUT)}.` : "\nPASSED — matrix and acceptance-map structure checks hold and both documents are current.");
