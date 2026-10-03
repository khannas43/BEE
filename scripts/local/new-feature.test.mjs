// The scaffolder must create what it says, register the route everywhere, keep the contract pin consistent, refuse to
// overwrite, and leave the route denied until implemented. Runs against a throwaway copy of the registries
// (NEW_FEATURE_ROOT), never the real tree. Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
  "lib/server/apiContract.ts",
  "scripts/local/contract-pin.json",
  "package.json",
];

function copyControllers(dir, out) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) copyControllers(rel, out);
    else if (/Controller\.java$/.test(e.name)) out.push(rel);
  }
}

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "newfeature-"));
  const files = [...FILES];
  copyControllers("backend/src/main/java", files);
  for (const f of files) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    cpSync(join(ROOT, f), join(dir, f));
  }
  cpSync(join(ROOT, "app/api"), join(dir, "app/api"), { recursive: true });
  return dir;
}

function scaffold(dir, extra = []) {
  try {
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/local/new-feature.cjs"), "--name", "fee-confirmation", "--package", "finance", "--path", "/api/model-applications/{id}/fee-confirmation", ...extra],
      { env: { ...process.env, NEW_FEATURE_ROOT: dir }, encoding: "utf8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout?.toString() ?? "") + (e.stderr?.toString() ?? "") };
  }
}

const GENERATED = [
  "backend/src/main/java/gov/bee/api/finance/FeeConfirmationController.java",
  "backend/src/main/java/gov/bee/api/finance/FeeConfirmationService.java",
  "backend/src/main/java/gov/bee/api/finance/FeeConfirmationRepository.java",
  "app/api/runtime/model-applications/[id]/fee-confirmation/route.ts",
  "lib/server/contracts/fee-confirmation.ts",
  "lib/client/runtimeFeeConfirmation.ts",
  "scripts/local/fee-confirmation.test.mjs",
];

test("a dry run writes nothing and a bad name or path is refused", () => {
  const dir = sandbox();
  try {
    const dry = scaffold(dir, ["--dry-run", "--apply"]);
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /would create: backend\/src\/main\/java\/gov\/bee\/api\/finance\/FeeConfirmationService\.java/);
    for (const f of GENERATED) assert.equal(existsSync(join(dir, f)), false, f);
    assert.equal(readFileSync(join(dir, "docs/wp03/bee-local-api.openapi.json"), "utf8").includes("fee-confirmation"), false);
    const bad = execFileSync(process.execPath, ["-e", `
      const { spawnSync } = require("child_process");
      const r = spawnSync(process.execPath, [${JSON.stringify(join(ROOT, "scripts/local/new-feature.cjs"))}, "--name", "Bad_Name", "--path", "/api/other"], { encoding: "utf8", env: { ...process.env, NEW_FEATURE_ROOT: ${JSON.stringify(dir)} } });
      process.stdout.write(r.status + " " + r.stderr);`], { encoding: "utf8" });
    assert.match(bad, /^2 new-feature: --name is required/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--apply creates the files, registers the route everywhere, bumps and re-pins the contract, and passes the wiring check", () => {
  const dir = sandbox();
  try {
    const r = scaffold(dir, ["--apply"]);
    assert.equal(r.code, 0, r.out);
    for (const f of GENERATED) assert.equal(existsSync(join(dir, f)), true, f);
    assert.match(r.out, /wiring check: wiring checks: \d+ passed, 0 failed/);
    assert.match(readFileSync(join(dir, "backend/src/main/java/gov/bee/api/security/SecurityConfig.java"), "utf8"), /requestMatchers\(HttpMethod\.POST, "\/api\/model-applications\/\*\/fee-confirmation"\)\.authenticated\(\)/);
    assert.match(readFileSync(join(dir, "lib/server/requestLog.ts"), "utf8"), /"\/api\/runtime\/model-applications\/\{id\}\/fee-confirmation"/);
    assert.match(readFileSync(join(dir, "package.json"), "utf8"), /scripts\/local\/fee-confirmation\.test\.mjs/);
    // Contract: both layers documented, version bumped, pin and code agree with the file.
    const raw = readFileSync(join(dir, "docs/wp03/bee-local-api.openapi.json"), "utf8");
    const doc = JSON.parse(raw);
    assert.ok(doc.paths["/api/model-applications/{id}/fee-confirmation"].post);
    assert.ok(doc.paths["/api/runtime/model-applications/{id}/fee-confirmation"].post);
    assert.ok(doc.components.schemas.FeeConfirmationRequest);
    assert.equal(doc.paths["/api/model-applications/{id}/fee-confirmation"]["x-bee-audience"], "internal");
    assert.equal(doc.paths["/api/runtime/model-applications/{id}/fee-confirmation"]["x-bee-audience"], "browser");
    const pin = JSON.parse(readFileSync(join(dir, "scripts/local/contract-pin.json"), "utf8"));
    assert.equal(doc.info.version, pin.version);
    assert.notEqual(pin.version, JSON.parse(readFileSync(join(ROOT, "docs/wp03/bee-local-api.openapi.json"), "utf8")).info.version, "the version moved");
    assert.equal(createHash("sha256").update(raw).digest("hex"), pin.sha256);
    assert.match(readFileSync(join(dir, "lib/server/apiContract.ts"), "utf8"), new RegExp(`CONTRACT_VERSION = "${pin.version}"`));
    // Safe by default: the generated service denies everyone until it is implemented.
    const svc = readFileSync(join(dir, GENERATED[1]), "utf8");
    assert.match(svc, /private static final boolean IMPLEMENTED = false;/);
    assert.match(svc, /if \(!IMPLEMENTED\) \{\s*return error\(HttpStatus\.FORBIDDEN, "denied_by_default"\);/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a second run refuses to overwrite and leaves the registrations untouched", () => {
  const dir = sandbox();
  try {
    assert.equal(scaffold(dir, ["--apply"]).code, 0);
    const before = readFileSync(join(dir, "docs/wp03/bee-local-api.openapi.json"), "utf8");
    const again = scaffold(dir, ["--apply"]);
    assert.equal(again.code, 2);
    assert.match(again.out, /refusing to overwrite/);
    assert.equal(readFileSync(join(dir, "docs/wp03/bee-local-api.openapi.json"), "utf8"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
