// Reject an application permanently: the browser client and the BFF validator. No Spring or Keycloak.
// The behaviour of the command itself is proven by SpringContractTest, ReworkDatabaseTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { runStageReject, stageRejectPath, stageRejectSignature } from "../../lib/client/runtimeStageReject.ts";
import { SPRING_STAGE_REJECT, validateStageRejectReceipt } from "../../lib/server/contracts/stage-reject.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-000000000009";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const RECEIPT = {
  applicationId: ID, reference: "LOCAL-MA-0100", fromState: "iame_scrutiny", toState: "rejected", version: 4,
  reason: "The report is for a different model.", rejectedAt: "2026-10-04T10:00:00Z",
};
const INPUT = { id: ID, version: 3, reason: "The report is for a different model." };

test("the client posts the version and the reason with the idempotency key and the cookie to the runtime route", async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (p, init) => {
    seen = { p, init };
    return json(200, RECEIPT, { "Idempotency-Replayed": "true" });
  };
  try {
    const r = await runStageReject(INPUT, KEY);
    assert.deepEqual([r.ok, r.value.toState, r.replayed], [true, "rejected", true]);
    assert.equal(seen.p, stageRejectPath(ID));
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.credentials, "include");
    assert.equal(seen.init.headers["Idempotency-Key"], KEY);
    assert.deepEqual(JSON.parse(seen.init.body), { version: 3, reason: INPUT.reason });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("each documented refusal is a typed failure with the contract's message, and a lost response is retryable", async () => {
  const realFetch = globalThis.fetch;
  const cases = [
    [403, "role_not_permitted", "This role cannot perform this action.", "denied"],
    [403, "segregation_refused", "A person who acted at another stage of this application, or its own organisation, cannot take this step.", "denied"],
    [409, "version_conflict", "The record has changed since it was loaded.", "conflict"],
    [422, "validation_failed", "The request could not be accepted.", "validation"],
  ];
  try {
    for (const [status, error, message, kind] of cases) {
      globalThis.fetch = async () => json(status, { error, message });
      const r = await runStageReject(INPUT, KEY);
      assert.deepEqual([r.ok, r.failure.kind, r.failure.message], [false, kind, message], error);
    }
    globalThis.fetch = async () => {
      throw new TypeError("network");
    };
    assert.equal((await runStageReject(INPUT, KEY)).failure.kind, "unavailable");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the signature changes with the version or the reason, so a different rejection gets a new key", () => {
  const base = stageRejectSignature(INPUT);
  assert.deepEqual(stageRejectSignature({ ...INPUT }), base);
  for (const change of [{ version: 4 }, { reason: "Another reason." }]) assert.notDeepEqual(stageRejectSignature({ ...INPUT, ...change }), base, JSON.stringify(change));
});

test("the BFF accepts the receipt from each of the five stages (Programme included) and refuses anything else", () => {
  assert.deepEqual(validateStageRejectReceipt(RECEIPT), RECEIPT);
  for (const fromState of ["iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval"]) {
    assert.ok(validateStageRejectReceipt({ ...RECEIPT, fromState }), fromState);
  }
  assert.equal(validateStageRejectReceipt({ ...RECEIPT, secret: "x" }), null, "an extra field is refused");
  for (const bad of [
    { fromState: "fee_due" }, { fromState: "returned" }, { fromState: "rejected" }, { toState: "returned" }, { version: 0 },
    { applicationId: "nope" }, { rejectedAt: "yesterday" }, { reason: 5 }, { reference: undefined },
  ]) {
    assert.equal(validateStageRejectReceipt({ ...RECEIPT, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(SPRING_STAGE_REJECT.successStatuses[0], 200);
  for (const code of ["role_not_permitted", "segregation_refused"]) assert.ok(SPRING_STAGE_REJECT.errors[403].includes(code), code);
});
