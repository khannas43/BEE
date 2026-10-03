// Screen kit transport (lib/client/runtimeHttp.ts): failure mapping, reads, the signed-out gate,
// payload-bound idempotency keys and commands. Fake fetch only; no Spring or Keycloak. Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commandFailure,
  gateRead,
  IDEMPOTENCY_KEY,
  PayloadKeyGate,
  readFailure,
  runtimeCommand,
  runtimeRead,
  runtimeReadInit,
  SIGNED_OUT,
} from "../../lib/client/runtimeHttp.ts";
import { runtimeReadInit as reExported } from "../../lib/client/runtimeModelApplications.ts";

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const KEY = "0123456789abcdef01234567";

test("readFailure maps statuses and codes to the one failure the screens render", () => {
  assert.deepEqual(readFailure(401, null), { kind: "session", code: "no_session", message: "Sign in to continue." });
  assert.equal(readFailure(401, { error: "session_expired" }).code, "session_expired");
  assert.equal(readFailure(403, { error: "mfa_required" }).code, "mfa_required");
  assert.equal(readFailure(403, {}).code, "no_read_scope");
  assert.equal(readFailure(404, { error: "anything" }).kind, "not_found");
  assert.equal(readFailure(503, { error: "service_unavailable" }).kind, "unavailable");
  assert.equal(readFailure(500, null).message, "The BEE service could not complete the request.");
});

test("not_found copy is identical whatever the body says (unknown, other organisation, malformed)", () => {
  const a = readFailure(404, { error: "not_found", message: "unknown" });
  const b = readFailure(404, { error: "not_found", message: "other organisation" });
  assert.deepEqual(a, b);
});

test("runtimeRead returns the parsed value, an invalid-response failure, or unreachable", async () => {
  const ok = await runtimeRead("/x", (b) => (b?.id ? b : null), async () => json(200, { id: "a" }));
  assert.deepEqual(ok, { ok: true, value: { id: "a" } });
  const odd = await runtimeRead("/x", (b) => (b?.id ? b : null), async () => json(200, { nope: 1 }));
  assert.equal(odd.ok, false);
  assert.equal(odd.failure.message, "The BEE service returned an unexpected response.");
  const down = await runtimeRead("/x", () => ({}), async () => {
    throw new TypeError("network");
  });
  assert.equal(down.ok, false);
  assert.equal(down.failure.message, "The BEE service is not reachable. Try again later.");
  const denied = await runtimeRead("/x", () => ({}), async () => json(403, { error: "no_effective_role" }));
  assert.equal(denied.failure.code, "no_effective_role");
});

test("runtimeRead sends the cookie and never an Authorization header", async () => {
  let seen;
  await runtimeRead("/x", () => ({}), async (_p, init) => {
    seen = init;
    return json(200, {});
  });
  assert.equal(seen.credentials, "include");
  assert.equal(seen.cache, "no-store");
  assert.equal(new Headers(seen.headers).has("authorization"), false);
  assert.equal(new Headers(runtimeReadInit({ Authorization: "Bearer x" }).headers).has("authorization"), false);
  assert.equal(reExported, runtimeReadInit, "the model-application module re-exports the kit's init");
});

test("gateRead never shows records for a signed-out identity and shows nothing while it loads", () => {
  const records = { ok: true, list: [1] };
  assert.equal(gateRead("loading", records), null);
  assert.equal(gateRead("signed-out", records), SIGNED_OUT);
  assert.equal(gateRead("signed-out", null), SIGNED_OUT);
  const failure = { ok: false, failure: { kind: "unavailable", message: "x" } };
  assert.equal(gateRead("signed-out", failure), failure, "a failure the read already produced wins");
  assert.equal(gateRead("signed-in", records), records);
  assert.equal(gateRead("signed-in", null), null);
});

test("PayloadKeyGate keeps one valid key per payload until cleared", () => {
  const gate = new PayloadKeyGate();
  const a = gate.keyFor({ file: "a.pdf", label: "x" });
  assert.match(a, IDEMPOTENCY_KEY);
  assert.equal(gate.keyFor({ file: "a.pdf", label: "x" }), a, "same payload reuses the key");
  const b = gate.keyFor({ file: "b.pdf", label: "x" });
  assert.notEqual(b, a, "a different payload gets a new key");
  gate.clear();
  assert.notEqual(gate.keyFor({ file: "b.pdf", label: "x" }), b, "after a known outcome the next send is a new command");
});

test("runtimeCommand sends JSON with the key and the cookie, and reports a replay", async () => {
  let seen;
  const r = await runtimeCommand("/c", "POST", { a: 1 }, KEY, (b) => (b?.id ? b : null), async (path, init) => {
    seen = { path, init };
    return json(201, { id: "n1" }, { "Idempotency-Replayed": "true" });
  });
  assert.deepEqual(r, { ok: true, replayed: true, value: { id: "n1" } });
  assert.equal(seen.path, "/c");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.credentials, "include");
  assert.equal(seen.init.headers["Idempotency-Key"], KEY);
  assert.equal(seen.init.headers["Content-Type"], "application/json");
  assert.equal(seen.init.body, '{"a":1}');
});

test("runtimeCommand sends FormData untouched, so the browser sets the multipart boundary", async () => {
  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.4"]), "r.pdf");
  let seen;
  await runtimeCommand("/c", "POST", form, KEY, () => ({}), async (_p, init) => {
    seen = init;
    return json(201, {});
  });
  assert.equal(seen.body, form);
  assert.equal("Content-Type" in seen.headers, false, "no Content-Type header: the boundary must come from the browser");
});

test("runtimeCommand refuses a missing or malformed key without sending anything", async () => {
  let called = false;
  const r = await runtimeCommand("/c", "PATCH", {}, "short", () => ({}), async () => {
    called = true;
    return json(200, {});
  });
  assert.equal(called, false);
  assert.equal(r.ok, false);
  assert.equal(r.failure.kind, "validation");
  assert.equal(r.failure.code, "idempotency_key_required");
});

test("runtimeCommand failure kinds", async () => {
  const run = (status, body) => runtimeCommand("/c", "POST", {}, KEY, () => ({}), async () => json(status, body));
  assert.equal((await run(401, {})).failure.kind, "session");
  assert.equal((await run(403, { error: "not_editable", message: "Not editable." })).failure.message, "Not editable.");
  assert.equal((await run(404, { message: "which one" })).failure.message, "No such record is available to you.");
  const conflict = await run(409, { error: "version_conflict" });
  assert.deepEqual([conflict.failure.kind, conflict.failure.code], ["conflict", "version_conflict"]);
  const invalid = await run(422, { error: "validation_failed" });
  assert.deepEqual([invalid.failure.kind, invalid.failure.code], ["validation", "validation_failed"]);
  assert.equal((await run(500, null)).failure.kind, "unavailable");
  const down = await runtimeCommand("/c", "POST", {}, KEY, () => ({}), async () => {
    throw new TypeError("network");
  });
  assert.equal(down.failure.message, "The BEE service is not reachable. Try again later.");
  const odd = await runtimeCommand("/c", "POST", {}, KEY, () => null, async () => json(201, {}));
  assert.equal(odd.failure.message, "The BEE service returned an unexpected response.");
  assert.equal(commandFailure(409, null).code, "");
});
