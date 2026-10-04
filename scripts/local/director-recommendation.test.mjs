// Director recommendation (first slice step 6): the browser client and the BFF validator. No Spring or Keycloak.
// The behaviour of the command itself is proven by SpringContractTest, DirectorRecommendationDatabaseTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { directorRecommendationPath, directorRecommendationSignature, runDirectorRecommendation } from "../../lib/client/runtimeDirectorRecommendation.ts";
import { SPRING_DIRECTOR_RECOMMENDATION, validateDirectorRecommendationReceipt } from "../../lib/server/contracts/director-recommendation.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-000000000009";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const RECEIPT = {
  applicationId: ID, reference: "LOCAL-MA-0100", fromState: "director_review", toState: "secretary_approval", version: 6,
  note: "Rating reviewed; recommend approval.", directorFinal: false, recommendedAt: "2026-10-04T10:00:00Z",
};
const INPUT = { id: ID, version: 5, note: "Rating reviewed; recommend approval." };

test("the client posts every field with the idempotency key and the cookie to the runtime route", async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (p, init) => {
    seen = { p, init };
    return json(200, RECEIPT, { "Idempotency-Replayed": "true" });
  };
  try {
    const r = await runDirectorRecommendation(INPUT, KEY);
    assert.deepEqual([r.ok, r.value.toState, r.replayed], [true, "secretary_approval", true]);
    assert.equal(seen.p, directorRecommendationPath(ID));
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.credentials, "include");
    assert.equal(seen.init.headers["Idempotency-Key"], KEY);
    assert.deepEqual(JSON.parse(seen.init.body), { version: 5, note: INPUT.note });
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
      const r = await runDirectorRecommendation(INPUT, KEY);
      assert.deepEqual([r.ok, r.failure.kind, r.failure.message], [false, kind, message], error);
    }
    globalThis.fetch = async () => {
      throw new TypeError("network");
    };
    assert.equal((await runDirectorRecommendation(INPUT, KEY)).failure.kind, "unavailable");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the signature changes with anything the reviewer entered, so a different forward gets a new key", () => {
  const base = directorRecommendationSignature(INPUT);
  assert.deepEqual(directorRecommendationSignature({ ...INPUT }), base);
  for (const change of [{ version: 6 }, { note: "Different note." }]) {
    assert.notDeepEqual(directorRecommendationSignature({ ...INPUT, ...change }), base, JSON.stringify(change));
  }
});

test("the BFF accepts the receipt and refuses anything extra, missing or malformed", () => {
  assert.deepEqual(validateDirectorRecommendationReceipt(RECEIPT), RECEIPT);
  assert.equal(validateDirectorRecommendationReceipt({ ...RECEIPT, secret: "x" }), null, "an extra field is refused");
  for (const bad of [
    { fromState: "rating" }, { toState: "rating" }, { version: 0 }, { applicationId: "nope" },
    { directorFinal: "yes" }, { directorFinal: true }, { recommendedAt: "yesterday" }, { note: 5 }, { reference: undefined },
  ]) {
    assert.equal(validateDirectorRecommendationReceipt({ ...RECEIPT, ...bad }), null, JSON.stringify(bad));
  }
  // Final for the category: the application goes straight to approved, and the two facts must agree.
  const FINAL = { ...RECEIPT, toState: "approved", directorFinal: true };
  assert.deepEqual(validateDirectorRecommendationReceipt(FINAL), FINAL);
  assert.equal(validateDirectorRecommendationReceipt({ ...FINAL, directorFinal: false }), null, "approved but not final is refused");
  assert.equal(SPRING_DIRECTOR_RECOMMENDATION.successStatuses[0], 200);
  for (const code of ["role_not_permitted", "segregation_refused"]) assert.ok(SPRING_DIRECTOR_RECOMMENDATION.errors[403].includes(code), code);
});
