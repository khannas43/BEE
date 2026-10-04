// IAME recommendation (first slice step 3): the browser client and the BFF validator. No Spring or Keycloak.
// The behaviour of the command itself is proven by SpringContractTest, IameRecommendationDatabaseTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { iameRecommendationPath, iameRecommendationSignature, runIameRecommendation } from "../../lib/client/runtimeIameRecommendation.ts";
import { SPRING_IAME_RECOMMENDATION, validateIameRecommendationReceipt } from "../../lib/server/contracts/iame-recommendation.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-000000000009";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const RECEIPT = {
  applicationId: ID, reference: "LOCAL-MA-0100", fromState: "iame_scrutiny", toState: "bee_scrutiny", version: 3,
  verification: "verified", note: "Report matches the declared laboratory and date.", recommendedAt: "2026-10-04T10:00:00Z",
};
const INPUT = { id: ID, version: 2, verification: "verified", note: "Report matches the declared laboratory and date." };

test("the client posts every field with the idempotency key and the cookie to the runtime route", async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (p, init) => {
    seen = { p, init };
    return json(200, RECEIPT, { "Idempotency-Replayed": "true" });
  };
  try {
    const r = await runIameRecommendation(INPUT, KEY);
    assert.deepEqual([r.ok, r.value.toState, r.replayed], [true, "bee_scrutiny", true]);
    assert.equal(seen.p, iameRecommendationPath(ID));
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.credentials, "include");
    assert.equal(seen.init.headers["Idempotency-Key"], KEY);
    assert.deepEqual(JSON.parse(seen.init.body), { version: 2, verification: "verified", note: INPUT.note });
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
    [409, "assignee_unavailable", "No officer is available to take the next stage.", "conflict"],
    [422, "validation_failed", "The request could not be accepted.", "validation"],
  ];
  try {
    for (const [status, error, message, kind] of cases) {
      globalThis.fetch = async () => json(status, { error, message });
      const r = await runIameRecommendation(INPUT, KEY);
      assert.deepEqual([r.ok, r.failure.kind, r.failure.message], [false, kind, message], error);
    }
    globalThis.fetch = async () => {
      throw new TypeError("network");
    };
    assert.equal((await runIameRecommendation(INPUT, KEY)).failure.kind, "unavailable");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the signature changes with anything the officer entered, so a different recommendation gets a new key", () => {
  const base = iameRecommendationSignature(INPUT);
  assert.deepEqual(iameRecommendationSignature({ ...INPUT }), base);
  for (const change of [{ version: 3 }, { verification: "not_verified" }, { note: "Different note." }]) {
    assert.notDeepEqual(iameRecommendationSignature({ ...INPUT, ...change }), base, JSON.stringify(change));
  }
});

test("the BFF accepts the receipt and refuses anything extra, missing or malformed", () => {
  assert.deepEqual(validateIameRecommendationReceipt(RECEIPT), RECEIPT);
  assert.equal(validateIameRecommendationReceipt({ ...RECEIPT, secret: "x" }), null, "an extra field is refused");
  for (const bad of [
    { fromState: "fee_due" }, { toState: "approved" }, { version: 0 }, { applicationId: "nope" }, { verification: "maybe" },
    { recommendedAt: "yesterday" }, { note: 5 }, { reference: undefined },
  ]) {
    assert.equal(validateIameRecommendationReceipt({ ...RECEIPT, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(SPRING_IAME_RECOMMENDATION.successStatuses[0], 200);
  for (const code of ["role_not_permitted", "segregation_refused"]) assert.ok(SPRING_IAME_RECOMMENDATION.errors[403].includes(code), code);
  assert.ok(SPRING_IAME_RECOMMENDATION.errors[409].includes("assignee_unavailable"));
});
