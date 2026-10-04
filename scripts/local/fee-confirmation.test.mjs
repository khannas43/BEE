// Fee confirmation (first slice step 2): the browser client and the BFF validator. No Spring or Keycloak.
// The behaviour of the command itself is proven by SpringContractTest, FeeConfirmationDatabaseTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { feeConfirmationPath, feeConfirmationSignature, runFeeConfirmation } from "../../lib/client/runtimeFeeConfirmation.ts";
import { SPRING_FEE_CONFIRMATION, validateFeeConfirmationReceipt } from "../../lib/server/contracts/fee-confirmation.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-000000000009";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const RECEIPT = {
  applicationId: ID, reference: "LOCAL-MA-0100", fromState: "fee_due", toState: "iame_scrutiny", version: 2,
  receiptReference: "UTR-1234", amountInr: "24000.00", receivedOn: "2026-10-02", confirmedAt: "2026-10-03T10:00:00Z",
};
const INPUT = { id: ID, version: 1, receiptReference: "UTR-1234", receivedOn: "2026-10-02", amountInr: "24000.00" };

test("the client posts every field with the idempotency key and the cookie to the runtime route", async () => {
  const realFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (p, init) => {
    seen = { p, init };
    return json(200, RECEIPT, { "Idempotency-Replayed": "true" });
  };
  try {
    const r = await runFeeConfirmation(INPUT, KEY);
    assert.deepEqual([r.ok, r.value.toState, r.replayed], [true, "iame_scrutiny", true]);
    assert.equal(seen.p, feeConfirmationPath(ID));
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.credentials, "include");
    assert.equal(seen.init.headers["Idempotency-Key"], KEY);
    assert.deepEqual(JSON.parse(seen.init.body), { version: 1, receiptReference: "UTR-1234", receivedOn: "2026-10-02", amountInr: "24000.00" });
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
    [422, "amount_mismatch", "The amount received does not match the fee due.", "validation"],
  ];
  try {
    for (const [status, error, message, kind] of cases) {
      globalThis.fetch = async () => json(status, { error, message });
      const r = await runFeeConfirmation(INPUT, KEY);
      assert.deepEqual([r.ok, r.failure.kind, r.failure.message], [false, kind, message], error);
    }
    globalThis.fetch = async () => {
      throw new TypeError("network");
    };
    assert.equal((await runFeeConfirmation(INPUT, KEY)).failure.kind, "unavailable");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the signature changes with anything the user typed, so a different confirmation gets a new key", () => {
  const base = feeConfirmationSignature(INPUT);
  assert.deepEqual(feeConfirmationSignature({ ...INPUT }), base);
  for (const change of [{ version: 2 }, { receiptReference: "UTR-9" }, { receivedOn: "2026-10-01" }, { amountInr: "23999.00" }]) {
    assert.notDeepEqual(feeConfirmationSignature({ ...INPUT, ...change }), base, JSON.stringify(change));
  }
});

test("the BFF accepts the receipt and refuses anything extra, missing or malformed", () => {
  assert.deepEqual(validateFeeConfirmationReceipt(RECEIPT), RECEIPT);
  assert.equal(validateFeeConfirmationReceipt({ ...RECEIPT, secret: "x" }), null, "an extra field is refused");
  for (const bad of [
    { fromState: "draft" }, { toState: "approved" }, { version: 0 }, { applicationId: "nope" }, { receivedOn: "02/10/2026" },
    { confirmedAt: "yesterday" }, { amountInr: 24000 }, { receiptReference: undefined },
  ]) {
    assert.equal(validateFeeConfirmationReceipt({ ...RECEIPT, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(SPRING_FEE_CONFIRMATION.successStatuses[0], 200);
  for (const code of ["role_not_permitted", "segregation_refused"]) assert.ok(SPRING_FEE_CONFIRMATION.errors[403].includes(code), code);
  assert.ok(SPRING_FEE_CONFIRMATION.errors[409].includes("assignee_unavailable"));
  assert.ok(SPRING_FEE_CONFIRMATION.errors[422].includes("amount_mismatch"));
});
