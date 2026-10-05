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
    if (!["get", "post", "patch"].includes(m)) continue;
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
  const draftRoutes = new Set(["/api/model-applications", "/api/model-applications/{id}", "/api/model-applications/eligible-brands"]);
  if (draftRoutes.has(p.route)) return mockMvc("draftOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/submit") return mockMvc("submitOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/fee-confirmation") return mockMvc("feeConfirmationOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/iame-recommendation") return mockMvc("iameRecommendationOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/reviewer-forward") return mockMvc("reviewerForwardOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/rating") return mockMvc("ratingOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/director-recommendation") return mockMvc("directorRecommendationOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/secretary-approval") return mockMvc("secretaryApprovalOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/return") return mockMvc("stageReturnOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/resubmit") return mockMvc("resubmitApplicationOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/reject") return mockMvc("stageRejectOperationsDocumentedPairs");
  if (p.route === "/api/fee-rules" || p.route === "/api/fee-rules/proposals" || p.route === "/api/fee-rules/proposals/{id}/decision") return mockMvc("feeRuleOperationsDocumentedPairs");
  if (p.route === "/api/rating-schemes" || p.route === "/api/rating-schemes/proposals" || p.route === "/api/rating-schemes/proposals/{id}/decision") return mockMvc("ratingSchemeOperationsDocumentedPairs");
  if (p.route === "/api/model-applications/{id}/history") return mockMvc("applicationHistoryOperationsDocumentedPairs");
  const documentRoutes = new Set(["/api/model-applications/{id}/documents", "/api/model-applications/{id}/documents/{documentId}/versions/{versionId}/content"]);
  if (documentRoutes.has(p.route)) return mockMvc("documentOperationsDocumentedPairs");
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
const UNIT_LINE = /^unit-evidence: (GET|POST|PATCH) (\S+) (\d+) (\S+)/;
const unitByPair = new Map();
for (const name of unitOk) {
  const p = UNIT_LINE.exec(name);
  if (p) unitByPair.set(key(p[2], p[1], Number(p[3]), p[4]), name);
}
function unitEvidence(p) {
  if (p.audience !== "browser" || p.route === "unmatched") return null;
  const label = unitByPair.get(key(p.route, p.method, p.status, p.code));
  return label ? `request-log.test.mjs: ${label.split("|")[0].trim()}` : null;
}
const headerSentinelErrs = contract.conforms(doc, "/api/runtime/me", "GET", { status: 200, json: {}, text: "{}", headers: new Headers() });
const unitSentinelSubmit = key("/api/runtime/model-applications/{id}/submit", "GET", 401, "session_expired");
const unitSentinelFake = key("/api/runtime/contract-sentinel-untested", "GET", 200, "-");

/* ---------- matrix ---------- */
function browser405ViaWrongMethod(p) {
  if (p.audience !== "browser" || p.status !== 405 || p.code !== "method_not_allowed" || p.method !== "GET") return 0;
  return observed.filter((o) => o.route === p.route && o.status === 405 && o.code === "method_not_allowed" && o.ok && o.method !== "GET").length;
}
const rows = pairs.map((p) => {
  const obs = live[pairKey(p)] || [];
  const l = obs.filter((o) => o.source === "live" && o.ok).length + browser405ViaWrongMethod(p);
  const s = obs.filter((o) => o.source === "live-stand-in" && o.ok).length;
  const mm = springEvidence(p), un = unitEvidence(p);
  const browserOnly = p.audience === "browser";
  const covered = browserOnly ? (l + s > 0 || !!un) : (l + s > 0 || !!mm || !!un);
  return { ...p, live: l, standIn: s, mockMvc: mm, unit: un, suites: [...new Set(obs.map((o) => o.suite))], covered };
});
const uncovered = rows.filter((r) => !r.covered);
const browserRows = rows.filter((r) => r.audience === "browser"), internalRows = rows.filter((r) => r.audience === "internal");
const browserUncovered = browserRows.filter((r) => !r.covered);
const internalUncovered = internalRows.filter((r) => !r.covered);
const count = (rs, f) => rs.filter(f).length;

check("coverage.header-sentinel", headerSentinelErrs.some((e) => /header|content-type/i.test(e)),
  `synthetic live response without contract headers is rejected (${headerSentinelErrs.slice(0, 2).join("; ") || "no errors"})`);
check("coverage.unit-sentinel-unmapped", !unitByPair.has(unitSentinelFake),
  `unit evidence is route-specific (${unitByPair.size} mapped pairs; fake route not credited)`);
check("coverage.unit-sentinel-mapped", unitByPair.has(unitSentinelSubmit),
  `submit GET 401 session_expired has a dedicated unit test (${unitSentinelSubmit})`);
check("coverage.inputs", observed.length > 0 && unitFailed.length === 0 && unitByPair.size >= 11 && reportNote.includes("all passed") && !reportNote.includes("STALE"),
  `${observed.length} live observations from ${OBSERVED.replace(ROOT + "/", "")}; request-log.test.mjs ${unitOk.size} passed (${unitByPair.size} unit-evidence pairs), ${unitFailed.length} failed; SpringContractTest report: ${reportNote}`);
check("coverage.live-observations-conform", failedObs.length === 0 && undocumented.length === 0,
  `${observed.length - failedObs.length}/${observed.length} live observations conform to the artifact${failedObs.length ? `; failing: ${failedObs.slice(0, 4).map((o) => `${o.method} ${o.route} ${o.status} ${o.code} (${o.suite})`).join(", ")}` : ""}${undocumented.length ? `; undocumented: ${undocumented.slice(0, 4).join(", ")}` : ""}`);
check("coverage.every-documented-pair-internal", internalUncovered.length === 0,
  `${internalRows.length - internalUncovered.length}/${internalRows.length} internal pairs evidenced (live ${count(internalRows, (r) => r.live)}, MockMvc ${count(internalRows, (r) => r.mockMvc)}, MockMvc-only ${count(internalRows, (r) => !r.live && r.mockMvc)})${internalUncovered.length ? `; UNCOVERED: ${internalUncovered.map((r) => key(r.route, r.method, r.status, r.code)).join(", ")}` : ""}`);
check("coverage.browser-documented-pair", browserUncovered.length === 0,
  `${browserRows.length - browserUncovered.length}/${browserRows.length} browser pairs evidenced at the Next.js boundary (live ${count(browserRows, (r) => r.live)}, stand-in ${count(browserRows, (r) => r.standIn)}, unit ${count(browserRows, (r) => r.unit)}); overall ${rows.length - uncovered.length}/${rows.length} including internal Spring MockMvc${browserUncovered.length ? `; UNCOVERED browser: ${browserUncovered.map((r) => key(r.route, r.method, r.status, r.code)).join(", ")}` : ""}`);

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
