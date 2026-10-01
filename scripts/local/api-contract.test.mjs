// Unit tests for lib/server/apiContract.ts and the OpenAPI artifact's error table (WP03.1). Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { acceptCorrelationId, callbackOutcome, CONTRACT_VERSION, correlationIdFrom, ERROR_MESSAGES, errorBody, fromUpstream, LOGIN_REDIRECT_CODES, ME_OPTIONAL, ME_REQUIRED, safeLoginCode, SPRING_LIST, SPRING_LIST_ERRORS, SPRING_ME, SPRING_ME_ERRORS, SPRING_READ, SPRING_READ_ERRORS, springIdSegment, MODEL_APPLICATION_KEYS, MODEL_APPLICATION_LIST_KEYS, MODEL_STATES } from "../../lib/server/apiContract.ts";

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

const SUBJECT = "3d6f0a8e-0000-4000-a000-000000000001";
const ME = {
  subject: SUBJECT, username: "nova.applicant", displayName: "Nova", authority: "spring-database",
  effectiveRoles: [{ role: "manufacturer", scope: "own-org" }], organisations: [{ code: "NOVA", kind: "manufacturer", name: "Nova" }],
  activeAssignments: 0, tokenRoles: ["manufacturer"], authMethods: ["pwd", "otp"], ignoredTokenClaims: { organisation: "PixelCert Agency" },
};
const SECRET = "planted-secret-7f3a9c";
const SQL = "ERROR: relation \"app.user_account\" SELECT password_hash FROM app.user_account WHERE id = '1' -- at gov.bee.api";
const leaks = (v) => { const t = JSON.stringify(v); return t.includes(SECRET) || /SELECT|password_hash|user_account|gov\.bee/.test(t); };
const encodedLeak = (url) => [SECRET, SQL, encodeURIComponent(SQL), "SELECT", "password_hash"].some((x) => url.includes(x));

test("a valid Me passes through unchanged", () => {
  assert.deepEqual(fromUpstream(200, ME, SPRING_ME), { ok: true, status: 200, body: ME });
  const noClaims = { ...ME };
  delete noClaims.ignoredTokenClaims;
  assert.equal(fromUpstream(200, noClaims, SPRING_ME).ok, true);
});

test("a 200 with an extra secret field is a fixed 502 and the secret is dropped", () => {
  for (const body of [
    { ...ME, secretToken: SECRET },
    { ...ME, effectiveRoles: [{ role: "manufacturer", scope: "own-org", secret: SECRET }] },
    { ...ME, organisations: [{ code: "NOVA", kind: "manufacturer", name: "Nova", secret: SECRET }] },
    { ...ME, ignoredTokenClaims: { organisation: "x", access_token: SECRET } },
  ]) {
    const out = fromUpstream(200, body, SPRING_ME);
    assert.deepEqual(out, { ok: false, status: 502, body: errorBody("invalid_api_response") });
    assert.equal(leaks(out), false);
  }
});

test("malformed 200 bodies are a fixed 502", () => {
  const noSubject = { ...ME };
  delete noSubject.subject;
  for (const body of [null, "text", [], {}, noSubject, { ...ME, subject: "not-a-uuid" }, { ...ME, authority: "keycloak" }, { ...ME, effectiveRoles: [] },
    { ...ME, activeAssignments: -1 }, { ...ME, activeAssignments: 1.5 }, { ...ME, tokenRoles: [1] }, { ...ME, authMethods: null }, { ...ME, ignoredTokenClaims: { organisation: 7 } }]) {
    assert.deepEqual(fromUpstream(200, body, SPRING_ME), { ok: false, status: 502, body: errorBody("invalid_api_response") }, JSON.stringify(body));
  }
});

test("documented /api/me denials keep status and code with the contract message, never Spring's text", () => {
  for (const [status, codes] of Object.entries(SPRING_ME_ERRORS)) {
    for (const code of codes) {
      const out = fromUpstream(Number(status), { error: code, message: SQL }, SPRING_ME);
      assert.deepEqual(out, { ok: false, status: Number(status), body: errorBody(code) });
      assert.equal(leaks(out), false);
    }
  }
});

test("an error with SQL-like detail or an undocumented code is a fixed 502", () => {
  for (const [status, body] of [[403, { error: SQL }], [500, { error: "internal_error", message: SQL }], [500, { trace: SQL }], [403, { error: "no_read_scope" }], [404, { error: "not_found" }],
    [403, { error: "denied_by_default", detail: SQL }], [409, { error: "conflict" }], [400, null], [418, "text"], [301, null], [201, ME]]) {
    const out = fromUpstream(status, body, SPRING_ME);
    assert.deepEqual(out, { ok: false, status: 502, body: errorBody("api_error") }, `${status} ${JSON.stringify(body)}`);
    assert.equal(leaks(out), false);
  }
  assert.deepEqual(fromUpstream(503, { error: "api_unreachable" }, SPRING_ME), { ok: false, status: 503, body: errorBody("api_unreachable") });
  assert.deepEqual(fromUpstream(200, { error: "invalid_api_response" }, SPRING_ME), { ok: false, status: 502, body: errorBody("invalid_api_response") });
});

test("the callback redirect code is always a documented one", () => {
  assert.deepEqual(callbackOutcome(200, ME, SUBJECT), { ok: true, me: ME });
  assert.deepEqual(callbackOutcome(200, ME, "5d1c0000-0000-4000-a000-000000000002"), { ok: false, code: "subject_mismatch" });
  assert.deepEqual(callbackOutcome(200, { ...ME, secretToken: SECRET }, SUBJECT), { ok: false, code: "invalid_api_response" });
  assert.deepEqual(callbackOutcome(403, { error: "no_effective_role", message: SQL }, SUBJECT), { ok: false, code: "no_effective_role" });
  for (const [status, body] of [[403, { error: SQL }], [500, { error: "internal_error", message: SQL }], [403, { error: "../../evil?x=1" }], [401, { error: "no_session" }]]) {
    const out = callbackOutcome(status, body, SUBJECT);
    assert.deepEqual(out, { ok: false, code: "api_error" });
    const url = new URL(`/login?error=${out.code}`, "http://127.0.0.1:3100").toString();
    assert.equal(encodedLeak(url), false, url);
  }
  for (const bad of [SQL, "", null, undefined, 7, "internal_error", "not_found", "no_read_scope"]) assert.equal(safeLoginCode(bad), "api_error");
  for (const ok of LOGIN_REDIRECT_CODES) assert.equal(safeLoginCode(ok), ok);
});

test("the OpenAPI artifact lists every error code with the same message, and no others", () => {
  assert.equal(contract.openapi, "3.1.0");
  assert.match(contract.info.version, /^\d+\.\d+\.\d+$/);
  const listed = contract["x-bee-error-codes"];
  assert.deepEqual(Object.keys(listed).sort(), Object.keys(ERROR_MESSAGES).sort());
  for (const [code, entry] of Object.entries(listed)) assert.equal(entry.message, ERROR_MESSAGES[code], code);
  assert.deepEqual(contract.components.schemas.Error.properties.error.enum.slice().sort(), Object.keys(ERROR_MESSAGES).sort());
  assert.equal(contract.info.version, CONTRACT_VERSION);
});

test("the boundary enforces exactly what the artifact documents for /api/me and the callback", () => {
  const me = contract.components.schemas.Me;
  assert.deepEqual([...ME_REQUIRED].sort(), me.required.slice().sort());
  assert.deepEqual([...ME_REQUIRED, ...ME_OPTIONAL].sort(), Object.keys(me.properties).sort());
  assert.equal(me.additionalProperties, false);
  assert.equal(me.properties.ignoredTokenClaims.additionalProperties, false);
  const responses = contract.paths["/api/me"].get.responses;
  for (const [status, codes] of Object.entries(SPRING_ME_ERRORS)) assert.deepEqual([...codes].sort(), responses[status]["x-error-codes"].slice().sort(), status);
  const documented = Object.keys(responses).filter((s) => s !== "200" && s !== "500").sort();
  assert.deepEqual(Object.keys(SPRING_ME_ERRORS).sort(), documented);
  assert.deepEqual([...LOGIN_REDIRECT_CODES].sort(), contract["x-bee-login-redirect-codes"].slice().sort());
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

const APP = { id: "00000000-0000-4000-c000-000000000002", reference: "LOCAL-MA-0002", organisation: "NOVA", brandName: "Nova Cool", category: "RAC", modelNumber: "NC-RAC-18F", state: "fee_due", version: 1, readBasis: ["own-org"] };
const LIST = { items: [APP, { ...APP, id: "00000000-0000-4000-c000-000000000004", state: "bee_scrutiny", readBasis: ["own-org", "assigned", "stage:bee_scrutiny"] }], count: 2, authority: "spring-database" };

test("valid model list and detail pass through unchanged", () => {
  assert.deepEqual(fromUpstream(200, LIST, SPRING_LIST), { ok: true, status: 200, body: LIST });
  assert.deepEqual(fromUpstream(200, { items: [], count: 0, authority: "spring-database" }, SPRING_LIST).ok, true);
  assert.deepEqual(fromUpstream(200, APP, SPRING_READ), { ok: true, status: 200, body: APP });
});

test("a planted secret anywhere in a list or detail is a fixed 502 without the secret", () => {
  const bodies = [
    [SPRING_LIST, { ...LIST, secretToken: SECRET }],
    [SPRING_LIST, { ...LIST, items: [{ ...APP, secretToken: SECRET }] , count: 1 }],
    [SPRING_LIST, { ...LIST, items: [APP, { ...APP, owner: { password: SECRET } }] }],
    [SPRING_LIST, { ...LIST, items: [{ ...APP, readBasis: ["own-org", { secret: SECRET }] }], count: 1 }],
    [SPRING_READ, { ...APP, secretToken: SECRET }],
    [SPRING_READ, { ...APP, readBasis: [{ secret: SECRET }] }],
    [SPRING_READ, { ...APP, readBasis: [SECRET] }],
  ];
  for (const [op, body] of bodies) {
    const out = fromUpstream(200, body, op);
    assert.deepEqual(out, { ok: false, status: 502, body: errorBody("invalid_api_response") });
    assert.equal(leaks(out), false);
  }
});

test("malformed list and detail bodies are a fixed 502", () => {
  const omit = (o, k) => { const c = { ...o }; delete c[k]; return c; };
  const lists = [null, [], "x", {}, omit(LIST, "count"), { ...LIST, count: 3 }, { ...LIST, count: "2" }, { ...LIST, items: {} }, { ...LIST, authority: "keycloak" }, { ...LIST, items: [null], count: 1 }];
  const details = [null, [], LIST, omit(APP, "version"), { ...APP, id: "LOCAL-MA-0002" }, { ...APP, state: "deleted" }, { ...APP, version: -1 }, { ...APP, version: 1.5 },
    { ...APP, version: "1" }, { ...APP, readBasis: [] }, { ...APP, readBasis: ["all"] }, { ...APP, brandName: null }, { ...APP, organisation: 7 }];
  for (const b of lists) assert.deepEqual(fromUpstream(200, b, SPRING_LIST), { ok: false, status: 502, body: errorBody("invalid_api_response") }, JSON.stringify(b));
  for (const b of details) assert.deepEqual(fromUpstream(200, b, SPRING_READ), { ok: false, status: 502, body: errorBody("invalid_api_response") }, JSON.stringify(b));
});

test("model read denials keep only documented codes; SQL-like or undocumented errors are a fixed 502", () => {
  assert.deepEqual(fromUpstream(404, { error: "not_found", message: SQL }, SPRING_READ), { ok: false, status: 404, body: errorBody("not_found") });
  assert.deepEqual(fromUpstream(403, { error: "no_read_scope", message: SQL }, SPRING_LIST), { ok: false, status: 403, body: errorBody("no_read_scope") });
  for (const [op, status, body] of [[SPRING_LIST, 404, { error: "not_found" }], [SPRING_READ, 404, { error: SQL }], [SPRING_READ, 403, { error: SQL, message: SQL }],
    [SPRING_READ, 500, { error: "internal_error", message: SQL }], [SPRING_LIST, 409, { error: "version_conflict" }], [SPRING_READ, 400, null], [SPRING_READ, 403, { error: "denied_by_default" }]]) {
    const out = fromUpstream(status, body, op);
    assert.deepEqual(out, { ok: false, status: 502, body: errorBody("api_error") }, `${status} ${JSON.stringify(body)}`);
    assert.equal(leaks(out), false);
  }
});

test("detail IDs are not shape-checked in Next; only unsafe path segments are replaced", () => {
  for (const id of ["00000000-0000-4000-c000-000000000002", "LOCAL-MA-0003", "1", "not-a-uuid", "a.b_c~d"]) assert.equal(springIdSegment(id), id);
  for (const id of ["", ".", "..", "../me", "a/b", "a%2Fb", "a b", "a;b", "a?b", "a#b", "é", "x".repeat(129)]) assert.equal(springIdSegment(id), "-");
});

test("the model read operations enforce exactly what the artifact documents", () => {
  const app = contract.components.schemas.ModelApplication, list = contract.components.schemas.ModelApplicationList;
  assert.deepEqual([...MODEL_APPLICATION_KEYS].sort(), app.required.slice().sort());
  assert.deepEqual([...MODEL_APPLICATION_KEYS].sort(), Object.keys(app.properties).sort());
  assert.deepEqual([...MODEL_APPLICATION_LIST_KEYS].sort(), list.required.slice().sort());
  assert.equal(app.additionalProperties, false);
  assert.equal(list.additionalProperties, false);
  assert.deepEqual([...MODEL_STATES], app.properties.state.enum);
  for (const [route, table] of [["/api/model-applications", SPRING_LIST_ERRORS], ["/api/model-applications/{id}", SPRING_READ_ERRORS]]) {
    const responses = contract.paths[route].get.responses;
    const documented = Object.keys(responses).filter((x) => x !== "200" && x !== "500").sort();
    assert.deepEqual(Object.keys(table).sort(), documented, route);
    for (const [status, codes] of Object.entries(table)) assert.deepEqual([...codes].sort(), responses[status]["x-error-codes"].slice().sort(), `${route} ${status}`);
  }
  for (const [bff, spring] of [["/api/runtime/model-applications", "/api/model-applications"], ["/api/runtime/model-applications/{id}", "/api/model-applications/{id}"]]) {
    const b = contract.paths[bff].get.responses, sp = contract.paths[spring].get.responses;
    assert.deepEqual(b["200"].content["application/json"].schema, sp["200"].content["application/json"].schema, bff);
    for (const status of ["403", "404"]) if (sp[status]) assert.deepEqual(b[status]["x-error-codes"], sp[status]["x-error-codes"], `${bff} ${status}`);
  }
  assert.equal(contract["x-bee-deferred"].some((d) => /runtime\/model-applications/.test(d.route)), false);
  assert.match(contract["x-bee-idempotency"].status, /not implemented/);
});
