/* eslint-disable */
/**
 * Route wiring check. The OpenAPI artifact is the source of truth for which routes exist; this verifies each one is
 * registered everywhere a route has to be, so a missed registry fails here with the file named, not later as a 401, an
 * "unmapped" log line or a schema failure. Static and fast (no runtime needed). Run: npm run local:wiring
 *
 * Spring routes (x-bee-audience: internal): a controller mapping, the security allowlist (anything else is denied by
 * default), the correlation-ID filter's route map, the request-log route union and schema.
 * Browser routes (/api/runtime/* and /api/auth/*): the Next.js route file, its logged() template, the request-log
 * route union and schema.
 * Reverse: every template in the request-log unions is a documented route.
 *
 * The scaffolder (new-feature.cjs) applies these registrations; this is its safety net and a check on hand edits.
 */
const fs = require("fs");
const path = require("path");

// WIRING_ROOT lets the tests run this against doctored copies of the registries.
const ROOT = process.env.WIRING_ROOT || path.join(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

let pass = 0;
let fail = 0;
const failures = [];
function check(id, ok, detail) {
  if (ok) pass++;
  else {
    fail++;
    failures.push(`${id}: ${detail}`);
  }
}

const doc = JSON.parse(read("docs/wp03/bee-local-api.openapi.json"));
const securityConfig = read("backend/src/main/java/gov/bee/api/security/SecurityConfig.java");
const correlationFilter = read("backend/src/main/java/gov/bee/api/web/CorrelationIdFilter.java");
const requestLogTs = read("lib/server/requestLog.ts");
const requestLogSchema = read("docs/wp03/request-log.schema.json");

/** Every Java controller source, joined: a mapping string only has to appear in one of them. */
function controllerSources() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/Controller\.java$/.test(e.name)) out.push(fs.readFileSync(f, "utf8"));
    }
  };
  walk(path.join(ROOT, "backend/src/main/java"));
  return out.join("\n");
}
const controllers = controllerSources();

/** The unions in requestLog.ts, by name, as sets of template strings. */
function unionOf(name) {
  const m = requestLogTs.match(new RegExp(`type ${name}\\s*=([\\s\\S]*?);`));
  return new Set(m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : []);
}
const runtimeRoutes = unionOf("WebRoute");
const springRoutes = unionOf("SpringRoute");

/** requestMatchers statements in the security config: method -> set of path patterns. */
function securityMatchers() {
  const byMethod = {};
  for (const m of securityConfig.matchAll(/requestMatchers\(([^)]*)\)/g)) {
    const method = /HttpMethod\.(\w+)/.exec(m[1])?.[1];
    if (!method) continue;
    for (const p of m[1].matchAll(/"([^"]+)"/g)) (byMethod[method] ||= new Set()).add(p[1]);
  }
  return byMethod;
}
const matchers = securityMatchers();

const toStar = (p) => p.replace(/\{[^}]+\}/g, "*");
const toNextFile = (p) => `app${p.replace(/\{([^}]+)\}/g, "[$1]")}/route.ts`;
const count = (hay, needle) => hay.split(needle).length - 1;

for (const [route, item] of Object.entries(doc.paths)) {
  const audience = item["x-bee-audience"];
  const methods = Object.keys(item).filter((k) => ["get", "post", "put", "patch", "delete"].includes(k));
  if (audience === "internal") {
    if (route.startsWith("/actuator/")) continue; // framework endpoints, allowed by pattern, not mapped by a controller
    check(`spring ${route} controller`, controllers.includes(`"${route}"`), "no controller mapping names this template");
    for (const m of methods) {
      const M = m.toUpperCase();
      const star = toStar(route);
      check(`spring ${M} ${route} security`, !!matchers[M]?.has(star), `SecurityConfig has no requestMatchers(HttpMethod.${M}, "${star}"): the route would be denied by default`);
    }
    check(`spring ${route} correlation filter`, correlationFilter.includes(`"${route}"`), "CorrelationIdFilter.route() does not map it: its log line would say unmapped");
    check(`spring ${route} request-log union`, springRoutes.has(route), "lib/server/requestLog.ts SpringRoute does not list it");
    check(`spring ${route} request-log schema`, count(requestLogSchema, `"${route}"`) >= 2, "docs/wp03/request-log.schema.json does not list it in both Spring route enums");
  } else if (audience === "browser" && route.startsWith("/api/")) {
    const file = toNextFile(route);
    check(`browser ${route} route file`, exists(file), `${file} does not exist`);
    if (exists(file)) check(`browser ${route} logged()`, read(file).includes(`logged("${route}"`), `${file} does not wrap its handlers in logged("${route}")`);
    check(`browser ${route} request-log union`, runtimeRoutes.has(route), "lib/server/requestLog.ts WebRoute does not list it");
    check(`browser ${route} request-log schema`, requestLogSchema.includes(`"${route}"`), "docs/wp03/request-log.schema.json does not list it");
  }
}

// Reverse: nothing in the request-log unions that the contract does not document.
const documented = new Set(Object.keys(doc.paths));
for (const [union, routes] of [["WebRoute", runtimeRoutes], ["SpringRoute", springRoutes]]) {
  for (const r of routes) {
    if (!r.startsWith("/") || r.includes("{unmatched}")) continue; // "unmatched" / "unmapped" sentinels, not routes
    check(`${union} ${r} documented`, documented.has(r), "listed in requestLog.ts but not a path in the OpenAPI artifact");
  }
}

const total = pass + fail;
for (const f of failures) console.log(`FAIL ${f}`);
console.log(`wiring checks: ${pass} passed, ${fail} failed (of ${total} across ${Object.keys(doc.paths).length} documented routes)`);
process.exit(fail ? 1 : 0);
