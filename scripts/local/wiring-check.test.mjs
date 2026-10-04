// The route wiring check must catch each kind of omission, naming the file. Runs the script against doctored copies of
// the registries (WIRING_ROOT), never the real tree. Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const FILES = [
  "docs/wp03/bee-local-api.openapi.json",
  "docs/wp03/request-log.schema.json",
  "backend/src/main/java/gov/bee/api/security/SecurityConfig.java",
  "backend/src/main/java/gov/bee/api/web/CorrelationIdFilter.java",
  "lib/server/requestLog.ts",
];

function copyControllers(dir, out) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) copyControllers(rel, out);
    else if (/Controller\.java$/.test(e.name)) out.push(rel);
  }
}

/** A throwaway copy of exactly the files the check reads; `edit` may change them before it runs. */
function run(edit = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), "wiring-"));
  try {
    const files = [...FILES];
    copyControllers("backend/src/main/java", files);
    for (const f of files) {
      mkdirSync(join(dir, f, ".."), { recursive: true });
      cpSync(join(ROOT, f), join(dir, f));
    }
    cpSync(join(ROOT, "app/api"), join(dir, "app/api"), { recursive: true });
    edit({
      read: (f) => readFileSync(join(dir, f), "utf8"),
      write: (f, text) => writeFileSync(join(dir, f), text),
      remove: (f) => rmSync(join(dir, f), { recursive: true }),
    });
    try {
      const out = execFileSync(process.execPath, [join(ROOT, "scripts/local/wiring-check.cjs")], { env: { ...process.env, WIRING_ROOT: dir }, encoding: "utf8" });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status, out: e.stdout?.toString() ?? "" };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SEC = "backend/src/main/java/gov/bee/api/security/SecurityConfig.java";
const LOG = "lib/server/requestLog.ts";

test("the real registries are consistent with the artifact", () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /wiring checks: \d+ passed, 0 failed/);
});

test("a route missing from the security allowlist is reported (it would be denied by default)", () => {
  const r = run(({ read, write }) => write(SEC, read(SEC).replace(/\n\s*\.requestMatchers\(HttpMethod\.POST, "\/api\/model-applications\/\*\/submit"\)\.authenticated\(\)/, "")));
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL spring POST \/api\/model-applications\/\{id\}\/submit security: SecurityConfig has no requestMatchers/);
});

test("a route missing from the correlation filter, request-log union or schema is reported", () => {
  let r = run(({ read, write }) => write("backend/src/main/java/gov/bee/api/web/CorrelationIdFilter.java", read("backend/src/main/java/gov/bee/api/web/CorrelationIdFilter.java").replace('"/api/model-applications/{id}/submit"', '"/api/x"')));
  assert.match(r.out, /FAIL spring \/api\/model-applications\/\{id\}\/submit correlation filter/);
  r = run(({ read, write }) => write(LOG, read(LOG).replace('  | "/api/runtime/model-applications/{id}/submit"\n', "")));
  assert.match(r.out, /FAIL browser \/api\/runtime\/model-applications\/\{id\}\/submit request-log union/);
  r = run(({ read, write }) => write("docs/wp03/request-log.schema.json", read("docs/wp03/request-log.schema.json").replaceAll('"/api/model-applications/{id}/documents"', '"/api/x"')));
  assert.match(r.out, /FAIL spring \/api\/model-applications\/\{id\}\/documents request-log schema/);
});

test("a missing Next.js route file, logged() wrapper or controller mapping is reported", () => {
  let r = run(({ remove }) => remove("app/api/runtime/model-applications/[id]/submit/route.ts"));
  assert.match(r.out, /FAIL browser \/api\/runtime\/model-applications\/\{id\}\/submit route file: app\/api\/runtime\/model-applications\/\[id\]\/submit\/route\.ts does not exist/);
  r = run(({ read, write }) => {
    const f = "app/api/runtime/model-applications/[id]/submit/route.ts";
    write(f, read(f).replaceAll('logged("/api/runtime/model-applications/{id}/submit"', 'logged("/api/runtime/other"'));
  });
  assert.match(r.out, /FAIL browser \/api\/runtime\/model-applications\/\{id\}\/submit logged\(\)/);
  r = run(({ read, write }) => {
    const f = "backend/src/main/java/gov/bee/api/application/ModelApplicationSubmitController.java";
    write(f, read(f).replaceAll('"/api/model-applications/{id}/submit"', '"/api/model-applications/{id}/other"'));
  });
  assert.match(r.out, /FAIL spring \/api\/model-applications\/\{id\}\/submit controller/);
});

test("a stale entry in the request-log union that the contract does not document is reported", () => {
  const r = run(({ read, write }) => write(LOG, read(LOG).replace('  | "/api/runtime/health"\n', '  | "/api/runtime/health"\n  | "/api/runtime/retired-route"\n')));
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL WebRoute \/api\/runtime\/retired-route documented/);
});
