// Unit tests for lib/server/apiContract.ts and the OpenAPI artifact's error table (WP03.1). Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acceptCorrelationId, correlationIdFrom, ERROR_MESSAGES, errorBody, fromUpstream } from "../../lib/server/apiContract.ts";

const contract = JSON.parse(readFileSync(new URL("../../docs/wp03/bee-local-api.openapi.json", import.meta.url), "utf8"));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("safe correlation IDs are kept and unsafe ones replaced", () => {
  for (const ok of ["abc", "A-1", "x".repeat(64), "3f2c0c1e-6c1b-4d55-9e0f-0d6f1a2b3c4d"]) {
    assert.equal(acceptCorrelationId(ok), ok);
    assert.equal(correlationIdFrom(ok), ok);
  }
  for (const bad of [null, undefined, "", "x".repeat(65), "has space", "a;b", "a\r\nSet-Cookie: x", "é", "../etc", "a_b"]) {
    assert.equal(acceptCorrelationId(bad), null);
    assert.match(correlationIdFrom(bad), UUID);
  }
});

test("error bodies are exactly code and fixed message", () => {
  for (const code of Object.keys(ERROR_MESSAGES)) {
    assert.deepEqual(Object.keys(errorBody(code)), ["error", "message"]);
    assert.equal(errorBody(code).message, ERROR_MESSAGES[code]);
  }
});

test("upstream successes and known denials pass through with the contract message", () => {
  assert.deepEqual(fromUpstream(200, { subject: "s" }), { status: 200, body: { subject: "s" } });
  for (const [status, code] of [[401, "unauthenticated"], [403, "mfa_required"], [403, "no_effective_role"], [403, "no_active_account"], [403, "denied_by_default"], [403, "no_read_scope"], [404, "not_found"], [503, "service_unavailable"]]) {
    assert.deepEqual(fromUpstream(status, { error: code, message: "upstream text is not trusted" }), { status, body: errorBody(code) });
  }
});

test("anything outside the contract becomes 502 or 503 without upstream detail", () => {
  assert.deepEqual(fromUpstream(503, { error: "api_unreachable" }), { status: 503, body: errorBody("api_unreachable") });
  assert.deepEqual(fromUpstream(200, { error: "invalid_api_response" }), { status: 502, body: errorBody("invalid_api_response") });
  for (const [status, body] of [[500, { error: "internal_error" }], [500, { trace: "at gov.bee..." }], [403, { error: "not_found" }], [404, { error: "made_up" }], [400, null], [418, "text"], [301, null]]) {
    assert.deepEqual(fromUpstream(status, body), { status: 502, body: errorBody("api_error") });
  }
});

test("the OpenAPI artifact lists every error code with the same message, and no others", () => {
  assert.equal(contract.openapi, "3.1.0");
  assert.match(contract.info.version, /^\d+\.\d+\.\d+$/);
  const listed = contract["x-bee-error-codes"];
  assert.deepEqual(Object.keys(listed).sort(), Object.keys(ERROR_MESSAGES).sort());
  for (const [code, entry] of Object.entries(listed)) assert.equal(entry.message, ERROR_MESSAGES[code], code);
  assert.deepEqual(contract.components.schemas.Error.properties.error.enum.slice().sort(), Object.keys(ERROR_MESSAGES).sort());
});

test("every example in the OpenAPI artifact matches its own schema", async () => {
  const { createRequire } = await import("node:module");
  const { validate } = createRequire(import.meta.url)("./contract-lib.cjs");
  let n = 0;
  for (const [route, item] of Object.entries(contract.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (typeof op !== "object" || !op.responses) continue;
      for (const [status, res] of Object.entries(op.responses)) {
        const media = res.content?.["application/json"];
        if (!media) continue;
        const examples = [media.example, ...Object.values(media.examples ?? {}).map((e) => e.value)].filter((e) => e !== undefined);
        for (const ex of examples) {
          assert.deepEqual(validate(media.schema, ex, contract), [], `${method} ${route} ${status}`);
          n++;
        }
      }
    }
  }
  assert.ok(n > 40, `only ${n} examples`);
});
