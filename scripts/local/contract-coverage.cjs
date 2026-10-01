/* eslint-disable */
/**
 * WP03.3 coverage matrix: every (operation, status, code) documented in
 * docs/wp03/bee-local-api.openapi.json, plus Spring's default-deny and the browser
 * catch-all, against the evidence that exercised it:
 *
 *   live           conforms() on a real response in the shared runtime ($CONTRACT_OBSERVED,
 *                  written by contract-check and bff-check)
 *   live-stand-in  real Next.js boundary, controlled stand-in answering on Spring's port
 *   MockMvc        backend SpringContractTest (surefire report newer than the Spring sources)
 *   unit           scripts/local/request-log.test.mjs (run here, TAP output)
 *
 *   node scripts/local/contract-coverage.cjs [observed.jsonl]
 *
 * Fails if a documented pair has no evidence, a live observation did not conform, or the
 * MockMvc report is missing, failing or older than the code it covers. Writes
 * .local/run/contract-coverage.md.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const contract = require("./contract-lib.cjs");

const ROOT = path.join(__dirname, "../..");
const RUN_DIR = path.join(ROOT, ".local/run");
const OBSERVED = process.argv[2] || process.env.CONTRACT_OBSERVED || path.join(RUN_DIR, "contract-observed.jsonl");
const doc = contract.load();

let pass = 0, fail = 0;
function check(id, ok, detail) {
  const r = ok ? "PASS" : "FAIL";
  ok ? pass++ : fail++;
  console.log(`${r.padEnd(4)} ${id.padEnd(34)} ${detail}`);
  if (process.env.AUTH_RESULTS) fs.appendFileSync(process.env.AUTH_RESULTS, JSON.stringify({ id, result: r, detail }) + "\n");
}

/* ---------- documented pairs ---------- */
const key = (route, method, status, code) => `${method} ${route} ${status} ${code}`;
const pairs = [];
for (const [route, p] of Object.entries(doc.paths)) {
  for (const [m, op] of Object.entries(p)) {
    if (!["get", "post"].includes(m)) continue;
    for (const [status, spec] of Object.entries(op.responses)) {
      for (const code of spec["x-error-codes"] || ["-"]) pairs.push({ audience: p["x-bee-audience"], route, method: m.toUpperCase(), status: Number(status), code });
    }
  }
}
pairs.push({ audience: "internal", route: "default-deny", method: "*", status: 401, code: "unauthenticated" });
pairs.push({ audience: "internal", route: "default-deny", method: "*", status: 403, code: "denied_by_default" });
pairs.push({ audience: "browser", route: "unmatched", method: "*", status: 404, code: "not_found" });
const pseudo = (route) => route === "default-deny" || route === "unmatched";
const pairKey = (x) => key(x.route, pseudo(x.route) ? "*" : x.method, x.status, x.code);

/* ---------- live observations ---------- */
const observed = fs.existsSync(OBSERVED) ? fs.readFileSync(OBSERVED, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const live = {};
for (const o of observed) (live[pairKey(o)] ||= []).push(o);
const failedObs = observed.filter((o) => !o.ok);
const undocumented = Object.keys(live).filter((k) => !pairs.some((p) => pairKey(p) === k));

/* ---------- MockMvc: SpringContractTest report, fresh and passing ---------- */
const REPORT = path.join(ROOT, "backend/target/surefire-reports/TEST-gov.bee.api.contract.SpringContractTest.xml");
const TEST_SRC = path.join(ROOT, "backend/src/test/java/gov/bee/api/contract/SpringContractTest.java");
const newest = (d) => { let t = 0; const walk = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const f = path.join(x, e.name); if (e.isDirectory()) walk(f); else t = Math.max(t, fs.statSync(f).mtimeMs); } }; walk(d); return t; };
const springTests = {};
let reportNote = "missing";
if (fs.existsSync(REPORT)) {
  const xml = fs.readFileSync(REPORT, "utf8");
  for (const m of xml.matchAll(/<testcase\b[^>]*\bname="([^"]+)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) springTests[m[1]] = !/<(failure|error|skipped)\b/.test(m[3] || "");
  const fresh = fs.statSync(REPORT).mtimeMs >= Math.max(newest(path.join(ROOT, "backend/src")), fs.statSync(contract.FILE).mtimeMs);
  const suite = xml.match(/<testsuite\b[^>]*>/)?.[0] || "";
  const attr = (n) => Number(suite.match(new RegExp(`\\b${n}="(\\d+)"`))?.[1] ?? NaN);
  /* an @AfterAll failure (the every-pair assertion) is reported in the suite's error/failure totals */
  const allOk = Object.values(springTests).length > 0 && Object.values(springTests).every(Boolean) && attr("failures") === 0 && attr("errors") === 0;
  reportNote = `${Object.keys(springTests).length} tests, ${allOk ? "all passed" : "FAILURES"}, ${fresh ? "newer than backend/src and the artifact" : "STALE (older than backend/src or the artifact)"}`;
  if (!fresh || !allOk) for (const k of Object.keys(springTests)) springTests[k] = false;
}
const javaSrc = fs.existsSync(TEST_SRC) ? fs.readFileSync(TEST_SRC, "utf8") : "";
const everyPair = /@AfterAll\s+static void everyDocumentedPairWasExercised\(/.test(javaSrc);
const mockMvc = (name) => (everyPair && javaSrc.includes(`void ${name}(`) && springTests[name] ? `SpringContractTest.${name}` : null);
function springEvidence(p) {
  if (p.audience !== "internal") return null;
  if (p.route === "default-deny") return mockMvc(p.code === "unauthenticated" ? "missingOrInvalidTokenIsUnauthenticated" : "everythingElseIsDeniedByDefault");
  if (p.route.startsWith("/actuator/health")) return mockMvc("healthUpAndDownMatchSpringHealth");
  const byCode = {
    "-": "successBodiesMatchTheirSchemas", unauthenticated: "missingOrInvalidTokenIsUnauthenticated", mfa_required: "identityDenialsAreDocumentedCodes",
    no_active_account: "identityDenialsAreDocumentedCodes", no_effective_role: "identityDenialsAreDocumentedCodes", no_read_scope: "identityDenialsAreDocumentedCodes",
    not_found: "unknownMalformedAndOutOfScopeIdsAreOneNotFound", service_unavailable: "databaseFailureIs503AndUnexpectedFailureIs500WithoutDetail",
    internal_error: "databaseFailureIs503AndUnexpectedFailureIs500WithoutDetail",
  };
  return byCode[p.code] ? mockMvc(byCode[p.code]) : null;
}

/* ---------- unit: Next.js handlers with Keycloak/Spring stubbed (request-log.test.mjs) ---------- */
let tap = "";
try {
  tap = execFileSync(process.execPath, ["--import", "./scripts/local/test-resolve.mjs", "--test", "--test-reporter=tap", "scripts/local/request-log.test.mjs"], { cwd: ROOT, env: { ...process.env, CONTRACT_OBSERVED: "" }, stdio: ["ignore", "pipe", "pipe"], timeout: 120000 }).toString();
} catch (e) { tap = e.stdout?.toString() || ""; }
const unitOk = new Set([...tap.matchAll(/^ok \d+ - (.+)$/gm)].map((m) => m[1].trim()));
const unitFailed = [...tap.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1].trim());
const UNIT = {
  identity_unavailable: "Keycloak unreachable during refresh: 503 identity_unavailable on every session read, session kept, Spring not called",
  session_expired: "Keycloak refusing the refresh with planted text: 401 session_expired or 503, only a fixed outcome logged",
  login: "Keycloak unreachable at sign-in start: 303 to identity_unavailable, logged under the request's correlation ID",
  callback: "a callback with a planted code, state and session_state logs only the route, status and redirect code",
};
function unitEvidence(p) {
  if (p.audience !== "browser" || p.route === "unmatched") return null;
  const name = p.code === "identity_unavailable" || p.code === "session_expired" ? UNIT[p.code]
    : p.route === "/api/auth/login" && p.status === 303 ? UNIT.login
    : p.route === "/api/auth/callback" && p.status === 303 ? UNIT.callback : null;
  return name && unitOk.has(name) ? `request-log.test.mjs: "${name.slice(0, 48)}..."` : null;
}

/* ---------- matrix ---------- */
const rows = pairs.map((p) => {
  const obs = live[pairKey(p)] || [];
  const l = obs.filter((o) => o.source === "live" && o.ok).length;
  const s = obs.filter((o) => o.source === "live-stand-in" && o.ok).length;
  const mm = springEvidence(p), un = unitEvidence(p);
  return { ...p, live: l, standIn: s, mockMvc: mm, unit: un, suites: [...new Set(obs.map((o) => o.suite))], covered: l + s > 0 || !!mm || !!un };
});
const uncovered = rows.filter((r) => !r.covered);
const browserRows = rows.filter((r) => r.audience === "browser"), internalRows = rows.filter((r) => r.audience === "internal");
const count = (rs, f) => rs.filter(f).length;

check("coverage.inputs", observed.length > 0 && unitFailed.length === 0 && unitOk.size >= 7 && reportNote.includes("all passed") && !reportNote.includes("STALE"),
  `${observed.length} live observations from ${OBSERVED.replace(ROOT + "/", "")}; request-log.test.mjs ${unitOk.size} passed, ${unitFailed.length} failed; SpringContractTest report: ${reportNote}`);
check("coverage.live-observations-conform", failedObs.length === 0 && undocumented.length === 0,
  `${observed.length - failedObs.length}/${observed.length} live observations conform to the artifact${failedObs.length ? `; failing: ${failedObs.slice(0, 4).map((o) => `${o.method} ${o.route} ${o.status} ${o.code} (${o.suite})`).join(", ")}` : ""}${undocumented.length ? `; undocumented: ${undocumented.slice(0, 4).join(", ")}` : ""}`);
check("coverage.every-documented-pair", uncovered.length === 0,
  `${rows.length - uncovered.length}/${rows.length} documented (operation, status, code) pairs have evidence: browser ${browserRows.length} (live ${count(browserRows, (r) => r.live)}, stand-in only ${count(browserRows, (r) => !r.live && r.standIn)}, unit only ${count(browserRows, (r) => !r.live && !r.standIn && r.unit)}); internal ${internalRows.length} (live ${count(internalRows, (r) => r.live)}, MockMvc ${count(internalRows, (r) => r.mockMvc)}, MockMvc only ${count(internalRows, (r) => !r.live && r.mockMvc)})${uncovered.length ? `; UNCOVERED: ${uncovered.map((r) => key(r.route, r.method, r.status, r.code)).join(", ")}` : ""}`);

const md = [
  `# WP03.3 contract coverage (${new Date().toISOString()})`,
  "",
  `Artifact ${doc.info.version}; ${observed.length} live observations; SpringContractTest: ${reportNote}.`,
  "",
  "| Audience | Operation | Status | Code | Live | Live stand-in | MockMvc | Unit |",
  "|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.audience} | ${r.method} ${r.route} | ${r.status} | ${r.code} | ${r.live || ""} | ${r.standIn || ""} | ${r.mockMvc || ""} | ${r.unit || ""} |`),
  "",
].join("\n");
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.writeFileSync(path.join(RUN_DIR, "contract-coverage.md"), md);
console.log(`     matrix written to .local/run/contract-coverage.md`);
console.log(`coverage checks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
