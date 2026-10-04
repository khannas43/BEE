// Resubmit a returned application: the browser client and the BFF validator. No Spring or Keycloak.
// The behaviour of the command itself is proven by SpringContractTest, ReworkDatabaseTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { resubmitApplicationPath, resubmitApplicationSignature, runResubmitApplication } from "../../lib/client/runtimeResubmitApplication.ts";
import { SPRING_RESUBMIT_APPLICATION, validateResubmitApplicationReceipt } from "../../lib/server/contracts/resubmit-application.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-000000000009";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const RECEIPT = {
  applicationId: ID, reference: "LOCAL-MA-0100", fromState: "returned", toState: "iame_scrutiny", version: 5,
  ratingSuperseded: false, resubmittedAt: "2026-10-04T10:00:00Z",
};
const INPUT = { id: ID, version: 4 };

test("the client posts the version, and the note only when there is one", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (p, init) => {
    seen.push({ p, init });
    return json(200, RECEIPT);
  };
  try {
    const r = await runResubmitApplication(INPUT, KEY);
    assert.deepEqual([r.ok, r.value.toState], [true, "iame_scrutiny"]);
    assert.equal(seen[0].p, resubmitApplicationPath(ID));
    assert.equal(seen[0].init.credentials, "include");
    assert.equal(seen[0].init.headers["Idempotency-Key"], KEY);
    assert.deepEqual(JSON.parse(seen[0].init.body), { version: 4 });
    await runResubmitApplication({ ...INPUT, note: "  Corrected the laboratory.  " }, KEY);
    assert.deepEqual(JSON.parse(seen[1].init.body), { version: 4, note: "Corrected the laboratory." });
    await runResubmitApplication({ ...INPUT, note: "   " }, KEY);
    assert.deepEqual(JSON.parse(seen[2].init.body), { version: 4 }, "a blank note is not sent");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("each documented refusal is a typed failure with the contract's message, and a lost response is retryable", async () => {
  const realFetch = globalThis.fetch;
  const cases = [
    [403, "not_returned", "Only a returned application can be resubmitted.", "denied"],
    [403, "no_write_scope", "This role cannot create or edit model application drafts.", "denied"],
    [409, "duplicate_model", "Another application already holds this brand and model number.", "conflict"],
    [422, "test_report_required", "A test report must be uploaded before the application can be submitted.", "validation"],
    [422, "laboratory_not_accredited", "The laboratory must hold an active accreditation for this category on the test date.", "validation"],
  ];
  try {
    for (const [status, error, message, kind] of cases) {
      globalThis.fetch = async () => json(status, { error, message });
      const r = await runResubmitApplication(INPUT, KEY);
      assert.deepEqual([r.ok, r.failure.kind, r.failure.message], [false, kind, message], error);
    }
    globalThis.fetch = async () => {
      throw new TypeError("network");
    };
    assert.equal((await runResubmitApplication(INPUT, KEY)).failure.kind, "unavailable");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the signature changes with the version or the note, ignoring surrounding spaces", () => {
  const base = resubmitApplicationSignature(INPUT);
  assert.deepEqual(resubmitApplicationSignature({ ...INPUT }), base);
  assert.deepEqual(resubmitApplicationSignature({ ...INPUT, note: "  " }), base, "a blank note is the same as none");
  for (const change of [{ version: 5 }, { note: "Changed." }]) assert.notDeepEqual(resubmitApplicationSignature({ ...INPUT, ...change }), base, JSON.stringify(change));
});

test("the BFF accepts the receipt and keeps the two facts consistent: rating again exactly when it was superseded", () => {
  assert.deepEqual(validateResubmitApplicationReceipt(RECEIPT), RECEIPT);
  for (const toState of ["iame_scrutiny", "bee_scrutiny", "director_review", "secretary_approval"]) {
    assert.ok(validateResubmitApplicationReceipt({ ...RECEIPT, toState }), toState);
  }
  const SUPERSEDED = { ...RECEIPT, toState: "rating", ratingSuperseded: true };
  assert.deepEqual(validateResubmitApplicationReceipt(SUPERSEDED), SUPERSEDED);
  assert.equal(validateResubmitApplicationReceipt({ ...SUPERSEDED, ratingSuperseded: false }), null, "rating but not superseded is refused");
  assert.equal(validateResubmitApplicationReceipt({ ...RECEIPT, ratingSuperseded: true }), null, "superseded but not rating is refused");
  assert.equal(validateResubmitApplicationReceipt({ ...RECEIPT, secret: "x" }), null, "an extra field is refused");
  for (const bad of [{ fromState: "draft" }, { toState: "approved" }, { toState: "returned" }, { version: 0 }, { applicationId: "nope" }, { resubmittedAt: "yesterday" }, { ratingSuperseded: "no" }]) {
    assert.equal(validateResubmitApplicationReceipt({ ...RECEIPT, ...bad }), null, JSON.stringify(bad));
  }
  assert.equal(SPRING_RESUBMIT_APPLICATION.successStatuses[0], 200);
  for (const code of ["not_returned", "no_write_scope", "brand_not_permitted"]) assert.ok(SPRING_RESUBMIT_APPLICATION.errors[403].includes(code), code);
  assert.ok(SPRING_RESUBMIT_APPLICATION.errors[409].includes("duplicate_model"));
  for (const code of ["test_report_required", "declared_efficiency_required", "test_date_invalid", "laboratory_not_accredited", "standard_not_available"]) {
    assert.ok(SPRING_RESUBMIT_APPLICATION.errors[422].includes(code), code);
  }
});
