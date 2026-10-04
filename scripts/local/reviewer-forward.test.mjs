// Reviewer forward (first slice step 4): the browser client and the BFF validator. No Spring or Keycloak.
// The behaviour of the command itself is proven by SpringContractTest, ReviewerForwardDatabaseTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewerForwardPath, reviewerForwardSignature, runReviewerForward } from "../../lib/client/runtimeReviewerForward.ts";
import { SPRING_REVIEWER_FORWARD, validateReviewerForwardReceipt } from "../../lib/server/contracts/reviewer-forward.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-000000000009";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const RECEIPT = {
  applicationId: ID, reference: "LOCAL-MA-0100", fromState: "bee_scrutiny", toState: "rating", version: 4,
  note: "Checked against the application and the IAME note.", forwardedAt: "2026-10-04T10:00:00Z",
};
const INPUT = { id: ID, version: 3, note: "Checked against the application and the IAME note." };

test("the client posts every field with the idempotency key and the cookie to the runtime route", async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (p, init) => {
    seen = { p, init };
    return json(200, RECEIPT, { "Idempotency-Replayed": "true" });
  };
  try {
    const r = await runReviewerForward(INPUT, KEY);
    assert.deepEqual([r.ok, r.value.toState, r.replayed], [true, "rating", true]);
    assert.equal(seen.p, reviewerForwardPath(ID));
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.credentials, "include");
    assert.equal(seen.init.headers["Idempotency-Key"], KEY);
    assert.deepEqual(JSON.parse(seen.init.body), { version: 3, note: INPUT.note });
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
      const r = await runReviewerForward(INPUT, KEY);
      assert.deepEqual([r.ok, r.failure.kind, r.failure.message], [false, kind, message], error);
    }
    globalThis.fetch = async () => {
      throw new TypeError("network");
    };
    assert.equal((await runReviewerForward(INPUT, KEY)).failure.kind, "unavailable");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the signature changes with anything the reviewer entered, so a different forward gets a new key", () => {
  const base = reviewerForwardSignature(INPUT);
  assert.deepEqual(reviewerForwardSignature({ ...INPUT }), base);
  for (const change of [{ version: 4 }, { note: "Different note." }]) {
    assert.notDeepEqual(reviewerForwardSignature({ ...INPUT, ...change }), base, JSON.stringify(change));
  }
});

test("the BFF accepts the receipt and refuses anything extra, missing or malformed", () => {
  assert.deepEqual(validateReviewerForwardReceipt(RECEIPT), RECEIPT);
  assert.equal(validateReviewerForwardReceipt({ ...RECEIPT, secret: "x" }), null, "an extra field is refused");
  for (const bad of [
    { fromState: "iame_scrutiny" }, { toState: "approved" }, { version: 0 }, { applicationId: "nope" },
    { forwardedAt: "yesterday" }, { note: 5 }, { reference: undefined },
  ]) {
    assert.equal(validateReviewerForwardReceipt({ ...RECEIPT, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(SPRING_REVIEWER_FORWARD.successStatuses[0], 200);
  for (const code of ["role_not_permitted", "segregation_refused"]) assert.ok(SPRING_REVIEWER_FORWARD.errors[403].includes(code), code);
});
