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

// ---- what to do after a command ----
import { commandAdvice, keepKeyAfter } from "../../lib/client/runtimeHttp.ts";
import { createModelApplicationDraft, patchModelApplicationDraft } from "../../lib/client/runtimeModelDrafts.ts";
import { previewModelApplicationSubmit, submitModelApplicationDraft } from "../../lib/client/runtimeModelSubmit.ts";
import { listModelDocuments, uploadModelDocument } from "../../lib/client/runtimeModelDocuments.ts";

test("the key is kept only when the outcome is unknown or still running", () => {
  const fail = (failure) => ({ ok: false, replayed: false, failure });
  assert.equal(keepKeyAfter({ ok: true, replayed: false, value: 1 }), false, "success: the next send is a new command");
  assert.equal(keepKeyAfter(fail({ kind: "unavailable", message: "x" })), true, "a lost response may have committed");
  assert.equal(keepKeyAfter(fail({ kind: "conflict", code: "idempotency_in_progress", message: "x" })), true, "the first request is still running");
  for (const f of [
    { kind: "validation", code: "validation_failed", message: "x" },
    { kind: "denied", message: "x" },
    { kind: "session", message: "x" },
    { kind: "not_found", message: "x" },
    { kind: "conflict", code: "version_conflict", message: "x" },
    { kind: "conflict", code: "idempotency_key_conflict", message: "x" },
    { kind: "conflict", code: "duplicate_model", message: "x" },
  ]) {
    assert.equal(keepKeyAfter(fail(f)), false, `${f.kind} ${f.code ?? ""}: a definite answer`);
  }
});

test("failure advice: retry, reload or sign in, never more than one", () => {
  assert.deepEqual(commandAdvice({ kind: "unavailable", message: "x" }), { retryable: true, reload: false, signIn: false });
  assert.deepEqual(commandAdvice({ kind: "conflict", code: "version_conflict", message: "x" }), { retryable: false, reload: true, signIn: false });
  assert.deepEqual(commandAdvice({ kind: "conflict", code: "idempotency_in_progress", message: "x" }), { retryable: true, reload: false, signIn: false });
  assert.deepEqual(commandAdvice({ kind: "session", message: "x" }), { retryable: false, reload: false, signIn: true });
  assert.deepEqual(commandAdvice({ kind: "validation", code: "validation_failed", message: "x" }), { retryable: false, reload: false, signIn: false });
});

// ---- the clients that now run on the kit ----
const APP = { id: "3d6f0a8e-0000-4000-a000-000000000009", reference: "LOCAL-MA-0100", version: 1 };

test("draft create and edit send JSON with the key and report replays and refusals", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    return json(init.method === "POST" ? 201 : 200, APP, init.method === "PATCH" ? { "Idempotency-Replayed": "true" } : {});
  };
  try {
    const created = await createModelApplicationDraft({ brandId: "b", category: "RAC", modelNumber: "M-1" }, KEY);
    assert.deepEqual([created.ok, created.application.id, created.replayed], [true, APP.id, false]);
    const patched = await patchModelApplicationDraft(APP.id, { version: 1, category: "RAC", modelNumber: "M-1", declaredIseer: null }, KEY);
    assert.deepEqual([patched.ok, patched.replayed], [true, true]);
    assert.equal(calls[0].path, "/api/runtime/model-applications");
    assert.equal(calls[1].path, `/api/runtime/model-applications/${APP.id}`);
    assert.equal(calls[1].init.method, "PATCH");
    assert.match(calls[1].init.body, /"declaredIseer":null/, "an explicit null reaches the server");
    globalThis.fetch = async () => json(409, { error: "version_conflict", message: "The record has changed since it was loaded." });
    const stale = await patchModelApplicationDraft(APP.id, { version: 0, category: "RAC", modelNumber: "M-1" }, KEY);
    assert.deepEqual([stale.ok, stale.failure.kind, stale.failure.code], [false, "conflict", "version_conflict"]);
    const noKey = await createModelApplicationDraft({ brandId: "b", category: "RAC", modelNumber: "M-1" }, "short");
    assert.equal(noKey.failure.kind, "validation");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("submit preview is a kit read and submit a kit command with the fee snapshot", async () => {
  const realFetch = globalThis.fetch;
  const fee = { amountInr: "24000.00", currency: "INR", feeRuleKey: "RAC:new_model", feeRuleVersion: 2, verificationStatus: "provisional", localDemoFee: true, label: "x" };
  try {
    globalThis.fetch = async () => json(200, { ready: false, version: 3, intakeNote: "n", evidenceGates: [] });
    const preview = await previewModelApplicationSubmit(APP.id);
    assert.deepEqual([preview.ok, preview.preview.version], [true, 3]);
    globalThis.fetch = async () => json(404, { error: "not_found", message: "which" });
    const missing = await previewModelApplicationSubmit(APP.id);
    assert.deepEqual([missing.ok, missing.failure.kind], [false, "not_found"]);
    let seen;
    globalThis.fetch = async (path, init) => {
      seen = { path, init };
      return json(200, { ...APP, state: "fee_due", submissionFee: fee });
    };
    const done = await submitModelApplicationDraft(APP.id, 3, { amountInr: "24000.00", feeRuleKey: "RAC:new_model", feeRuleVersion: 2 }, KEY);
    assert.deepEqual([done.ok, done.application.state, done.submissionFee.amountInr], [true, "fee_due", "24000.00"]);
    assert.equal(seen.path, `/api/runtime/model-applications/${APP.id}/submit`);
    assert.equal(JSON.parse(seen.init.body).version, 3);
    globalThis.fetch = async () => json(409, { error: "duplicate_model", message: "Another application already holds this brand and model number." });
    const dup = await submitModelApplicationDraft(APP.id, 3, { amountInr: "24000.00", feeRuleKey: "RAC:new_model", feeRuleVersion: 2 }, KEY);
    assert.deepEqual([dup.ok, dup.failure.kind, dup.failure.code, dup.failure.message], [false, "conflict", "duplicate_model", "Another application already holds this brand and model number."]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("document list is a kit read and upload a multipart kit command that reports a replay", async () => {
  const doc = { id: "d1", documentKind: "test_report", verificationStatus: "pending_local_verification", verificationNote: "n", versions: [] };
  const list = await listModelDocuments(APP.id, async () => json(200, { items: [doc], count: 1, authority: "spring-database", verificationNote: "n", localStore: true }));
  assert.deepEqual([list.ok, list.list.count], [true, 1]);
  const odd = await listModelDocuments(APP.id, async () => json(200, { items: [{ nope: 1 }], count: 1, authority: "spring-database" }));
  assert.equal(odd.failure.message, "The BEE service returned an unexpected response.");
  let seen;
  const file = new File([new Uint8Array([37, 80, 68, 70])], "report.pdf", { type: "application/pdf" });
  const up = await uploadModelDocument(APP.id, { file, reportLabel: "Lab A" }, KEY, async (path, init) => {
    seen = { path, init };
    return json(201, doc, { "Idempotency-Replayed": "true" });
  });
  assert.deepEqual([up.ok, up.value.id, up.replayed], [true, "d1", true]);
  assert.equal(seen.init.body.get("documentKind"), "test_report");
  assert.equal(seen.init.body.get("reportLabel"), "Lab A");
  assert.equal(seen.init.body.get("file").name, "report.pdf");
  assert.equal("Content-Type" in seen.init.headers, false, "the browser sets the multipart boundary");
  const refused = await uploadModelDocument(APP.id, { file, reportLabel: "Lab A" }, KEY, async () => json(403, { error: "not_editable", message: "Only draft applications can be edited." }));
  assert.deepEqual([refused.ok, refused.failure.kind, refused.failure.message], [false, "denied", "Only draft applications can be edited."]);
});
