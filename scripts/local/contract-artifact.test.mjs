// WP03.3: the OpenAPI artifact is pinned and internally consistent, and the request log
// format and retention are what docs/wp03/request-log.schema.json documents. Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CONTRACT_VERSION } from "../../lib/server/apiContract.ts";
import { RETENTION } from "../../lib/server/requestLog.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url));
const ARTIFACT = "docs/wp03/bee-local-api.openapi.json";
const contract = JSON.parse(read(ARTIFACT).toString("utf8"));
const pin = JSON.parse(read("scripts/local/contract-pin.json").toString("utf8"));
const logSchema = JSON.parse(read("docs/wp03/request-log.schema.json").toString("utf8"));
const { validate } = createRequire(import.meta.url)("./contract-lib.cjs");

const operations = () => Object.entries(contract.paths).flatMap(([route, item]) =>
  Object.entries(item).filter(([, op]) => typeof op === "object" && op.responses).map(([method, op]) => ({ route, method, op, audience: item["x-bee-audience"] })));

test("the artifact is pinned: version, content hash, and the code's version agree", () => {
  // The version is compared across the three places, never to a literal, so a contract bump needs no edit here.
  assert.match(pin.version, /^\d+\.\d+\.\d+$/);
  assert.equal(contract.info.version, pin.version, "artifact info.version differs from scripts/local/contract-pin.json");
  assert.equal(CONTRACT_VERSION, pin.version, "lib/server/apiContract.ts CONTRACT_VERSION differs from the pin");
  assert.equal(createHash("sha256").update(read(ARTIFACT)).digest("hex"), pin.sha256, "artifact content changed without a version bump and a new pin");
});

test("every documented response requires X-Correlation-Id and no-store; redirects document Location", () => {
  let n = 0;
  for (const { route, method, op } of operations()) {
    for (const [status, res] of Object.entries(op.responses)) {
      const where = `${method.toUpperCase()} ${route} ${status}`;
      assert.equal(res.headers?.["X-Correlation-Id"]?.$ref, "#/components/headers/CorrelationId", where);
      assert.equal(res.headers?.["Cache-Control"]?.$ref, "#/components/headers/NoStore", where);
      if (status.startsWith("3")) assert.ok(res.headers?.Location, `${where}: Location`);
      else if (res.content?.["application/pdf"]) assert.ok(status === "200", `${where}: PDF only on 200`);
      else assert.ok(res.content?.["application/json"]?.schema, `${where}: JSON schema`);
      n++;
    }
  }
  assert.equal(contract.components.headers.CorrelationId.required, true);
  assert.equal(contract.components.headers.NoStore.required, true);
  assert.ok(n >= 50, `${n} responses`);
});

test("every documented error code exists, has the response's status, and has a matching example", () => {
  const codes = contract["x-bee-error-codes"];
  for (const { route, method, op } of operations()) {
    for (const [status, res] of Object.entries(op.responses)) {
      const where = `${method.toUpperCase()} ${route} ${status}`;
      const schema = res.content?.["application/json"]?.schema?.$ref;
      if (Number(status) >= 400 && schema !== "#/components/schemas/Error") {
        assert.ok(route.endsWith("/health") && status === "503" && !res["x-error-codes"], `${where}: only health 503 may use a non-error body`);
      } else if (Number(status) >= 400) {
        assert.ok(res["x-error-codes"]?.length, `${where}: x-error-codes`);
        for (const code of res["x-error-codes"]) {
          assert.ok(codes[code], `${where}: unknown code ${code}`);
          assert.equal(codes[code].status, Number(status), `${where}: ${code}`);
          assert.deepEqual(res.content["application/json"].examples?.[code]?.value, { error: code, message: codes[code].message }, `${where}: example for ${code}`);
        }
      } else assert.equal(res["x-error-codes"], undefined, where);
    }
  }
});

test("request log lines: documented lines validate, planted or raw values do not", () => {
  const ok = [
    { ts: "2026-10-01T08:00:00.000Z", layer: "api", event: "request", correlationId: "abc-1", method: "GET", route: "/api/model-applications/{id}", status: 404, outcome: "not_found", durationMs: 2 },
    { ts: "2026-10-01T08:00:00.000Z", layer: "web", event: "upstream", correlationId: "abc-1", method: "GET", route: "/api/me", status: 503, outcome: "api_unreachable", durationMs: 2 },
    { ts: "2026-10-01T08:00:00.000Z", layer: "web", event: "identity", correlationId: "abc-1", operation: "token.refresh", status: 400, outcome: "invalid_grant", durationMs: 9 },
  ];
  for (const l of ok) assert.deepEqual(validate(logSchema.line, l, logSchema), [], JSON.stringify(l));
  const SECRET = "planted-secret-0c1d";
  const bad = [
    { ...ok[0], route: `/api/model-applications/${SECRET}` },
    { ...ok[0], route: "/api/model-applications?code=x" },
    { ...ok[0], token: SECRET },
    { ...ok[0], outcome: `Bearer ${SECRET}` },
    { ...ok[0], correlationId: "a b" },
    { ...ok[1], route: "/api/model-applications/00000000-0000-4000-c000-000000000002" },
    { ...ok[2], outcome: SECRET },
    { ...ok[2], description: SECRET },
    { ...ok[2], operation: "userinfo" },
  ];
  for (const l of bad) assert.notDeepEqual(validate(logSchema.line, l, logSchema), [], JSON.stringify(l));
});

test("retention is bounded and both layers use the documented limits", () => {
  const xml = read("backend/src/main/resources/logback-spring.xml").toString("utf8");
  const tag = (t) => xml.match(new RegExp(`<${t}>([^<]+)</${t}>`))?.[1];
  assert.equal(tag("file"), "${BEE_LOG_DIR}/api-requests.jsonl");
  assert.equal(tag("maxFileSize"), "5MB");
  assert.equal(Number(tag("maxHistory")), logSchema.retention.api.maxHistoryDays);
  assert.equal(tag("totalSizeCap"), `${logSchema.retention.api.totalSizeCapMB}MB`);
  assert.match(xml, /<logger name="bee.access" level="INFO" additivity="false">/);
  assert.equal(RETENTION.file, logSchema.retention.web.file);
  assert.equal(RETENTION.maxBytes, 5 * 1024 * 1024);
  assert.equal(RETENTION.maxRotatedFiles, logSchema.retention.web.maxRotatedFiles);
  assert.equal(RETENTION.maxAgeDays, logSchema.retention.web.maxAgeDays);
  const config = read("next.config.ts").toString("utf8");
  assert.match(config, /incomingRequests: false/, "Next's own request lines carry raw query strings");
});

test("no two operations of the same layer share a summary (a cloned operation must say what it does)", () => {
  // Several operations were once cloned from the fee-confirmation one and kept its summary; the code and the schemas were right,
  // so nothing failed. The summary is what a reader of the contract sees first, so it must differ per operation.
  const seen = new Map();
  for (const { route, method, op, audience } of operations()) {
    const key = `${audience}: ${op.summary}`;
    assert.ok(op.summary && op.summary.trim().length > 20, `${method.toUpperCase()} ${route} has no real summary`);
    assert.equal(seen.has(key), false, `${method.toUpperCase()} ${route} repeats the summary of ${seen.get(key)}: "${op.summary}"`);
    seen.set(key, `${method.toUpperCase()} ${route}`);
  }
});

test("a summary never describes a different transition than the route it documents", () => {
  const transitions = {
    "fee-confirmation": "fee_due", "iame-recommendation": "iame_scrutiny", "reviewer-forward": "bee_scrutiny", rating: "rating",
    "director-recommendation": "director_review", "secretary-approval": "secretary_approval",
  };
  for (const { route, op } of operations()) {
    const name = Object.keys(transitions).find((k) => route.endsWith(`/${k}`));
    if (name) assert.match(op.summary, new RegExp(`${transitions[name]}`), `${route} summary should name the stage it starts from (${transitions[name]}): "${op.summary}"`);
  }
});
