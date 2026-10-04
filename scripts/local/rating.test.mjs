// Rating (first slice step 5): the browser client and the BFF validator. No Spring or Keycloak.
// The behaviour of the command itself is proven by SpringContractTest, RatingDatabaseTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { ratingPath, ratingSignature, runRating } from "../../lib/client/runtimeRating.ts";
import { SPRING_RATING, validateRatingReceipt } from "../../lib/server/contracts/rating.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-000000000009";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const RECEIPT = {
  applicationId: ID, reference: "LOCAL-MA-0100", fromState: "rating", toState: "director_review", version: 5, ratingVersion: 1, schemeKey: "RAC-ISEER-DEMO-1",
  declaredIseer: "4.50", verifiedIseer: "4.62", stars: 4, localDemoRating: true, computedAt: "2026-10-04T10:00:00Z",
};
const INPUT = { id: ID, version: 4, verifiedIseer: "4.62" };

test("the client posts every field with the idempotency key and the cookie to the runtime route", async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (p, init) => {
    seen = { p, init };
    return json(200, RECEIPT, { "Idempotency-Replayed": "true" });
  };
  try {
    const r = await runRating(INPUT, KEY);
    assert.deepEqual([r.ok, r.value.toState, r.replayed], [true, "director_review", true]);
    assert.equal(seen.p, ratingPath(ID));
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.credentials, "include");
    assert.equal(seen.init.headers["Idempotency-Key"], KEY);
    assert.deepEqual(JSON.parse(seen.init.body), { version: 4, verifiedIseer: "4.62" });
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
    [422, "rating_below_threshold", "The verified efficiency is below the lowest star band, so no rating can be assigned.", "validation"],
  ];
  try {
    for (const [status, error, message, kind] of cases) {
      globalThis.fetch = async () => json(status, { error, message });
      const r = await runRating(INPUT, KEY);
      assert.deepEqual([r.ok, r.failure.kind, r.failure.message], [false, kind, message], error);
    }
    globalThis.fetch = async () => {
      throw new TypeError("network");
    };
    assert.equal((await runRating(INPUT, KEY)).failure.kind, "unavailable");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the signature changes with anything the officer entered, so a different rating gets a new key", () => {
  const base = ratingSignature(INPUT);
  assert.deepEqual(ratingSignature({ ...INPUT }), base);
  for (const change of [{ version: 5 }, { verifiedIseer: "4.63" }]) {
    assert.notDeepEqual(ratingSignature({ ...INPUT, ...change }), base, JSON.stringify(change));
  }
});

test("the BFF accepts the receipt and refuses anything extra, missing or malformed", () => {
  assert.deepEqual(validateRatingReceipt(RECEIPT), RECEIPT);
  assert.equal(validateRatingReceipt({ ...RECEIPT, secret: "x" }), null, "an extra field is refused");
  for (const bad of [
    { fromState: "bee_scrutiny" }, { toState: "approved" }, { version: 0 }, { ratingVersion: 0 }, { applicationId: "nope" },
    { stars: 0 }, { stars: 6 }, { stars: 4.5 }, { localDemoRating: false }, { computedAt: "yesterday" }, { verifiedIseer: 4.62 }, { reference: undefined },
  ]) {
    assert.equal(validateRatingReceipt({ ...RECEIPT, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(SPRING_RATING.successStatuses[0], 200);
  for (const code of ["rule_not_available", "rating_below_threshold"]) assert.ok(SPRING_RATING.errors[422].includes(code), code);
  for (const code of ["role_not_permitted", "segregation_refused"]) assert.ok(SPRING_RATING.errors[403].includes(code), code);
});
