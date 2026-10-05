// Fee-confirmation corrections: the browser client and the BFF validators. No Spring or Keycloak.
// The rules (a different person, nobody from the paying organisation or another stage, one pending per confirmation, the confirmation
// never edited) are proven by FeeCorrectionDatabaseTest, SpringContractTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CORRECTION_PROPOSALS_PATH, FEE_CORRECTIONS_PATH, correctionDecisionPath, decideCorrectionSignature, proposeCorrectionSignature, readFeeCorrections,
  runDecideCorrection, runProposeCorrection,
} from "../../lib/client/runtimeFeeCorrections.ts";
import {
  SPRING_FEE_CORRECTION_DECISION, SPRING_FEE_CORRECTION_PROPOSAL, SPRING_FEE_CORRECTIONS, validateFeeCorrectionAdmin, validateFeeCorrectionProposal,
} from "../../lib/server/contracts/fee-corrections.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-0000000000f3";
const APP = "3d6f0a8e-0000-4000-a000-0000000000f4";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const PROPOSAL = {
  id: ID, applicationId: APP, reference: "LOCAL-MA-0002", previousReceiptReference: "UTR-WRONG", previousReceivedOn: "2026-10-02", receiptReference: "UTR-RIGHT",
  receivedOn: "2026-10-01", reason: "The reference was mistyped", state: "pending", proposedBy: "BEE Finance", proposedByYou: true, proposedAt: "2026-10-04T10:00:00Z",
  decidedBy: null, decidedAt: null, decisionNote: null,
};
const ROW = {
  applicationId: APP, reference: "LOCAL-MA-0002", brandName: "Nova Cool", modelNumber: "NC-1", state: "iame_scrutiny", receiptReference: "UTR-WRONG", receivedOn: "2026-10-02",
  amountInr: "24000.00", confirmedBy: "BEE Finance", confirmedAt: "2026-10-03T10:00:00Z", correction: null, pendingProposalId: ID,
};
const ADMIN = { today: "2026-10-04", confirmations: [ROW], pending: [PROPOSAL], decided: [{ ...PROPOSAL, state: "approved", proposedByYou: false, decidedBy: "BEE Programme", decidedAt: "2026-10-04T11:00:00Z" }] };
const PROPOSE = { applicationId: APP, receiptReference: "UTR-RIGHT", receivedOn: "2026-10-01", reason: "The reference was mistyped" };

test("the client reads the confirmations, proposes with the key and the cookie, and decides on the proposal's own route", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (p, init) => {
    seen.push({ p, init });
    return p === FEE_CORRECTIONS_PATH ? json(200, ADMIN) : p === CORRECTION_PROPOSALS_PATH ? json(201, PROPOSAL) : json(200, { ...PROPOSAL, state: "withdrawn", decidedBy: "BEE Finance" });
  };
  try {
    const read = await readFeeCorrections();
    assert.deepEqual([read.ok, read.admin.confirmations.length, read.admin.pending[0].proposedByYou], [true, 1, true]);
    const created = await runProposeCorrection(PROPOSE, KEY);
    assert.deepEqual([created.ok, created.value.state], [true, "pending"]);
    const post = seen.find((s) => s.p === CORRECTION_PROPOSALS_PATH);
    assert.equal(post.init.method, "POST");
    assert.equal(post.init.credentials, "include");
    assert.equal(post.init.headers["Idempotency-Key"], KEY);
    assert.deepEqual(JSON.parse(post.init.body), PROPOSE);
    const decided = await runDecideCorrection({ id: ID, decision: "withdraw" }, KEY);
    assert.equal(decided.ok, true);
    assert.deepEqual(JSON.parse(seen.find((s) => s.p === correctionDecisionPath(ID)).init.body), { decision: "withdraw" });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("each documented refusal is a typed failure with the contract's message", async () => {
  const realFetch = globalThis.fetch;
  const cases = [
    [403, "role_not_permitted", "This role cannot perform this action.", "denied"],
    [403, "segregation_refused", "A person who acted at another stage of this application, or its own organisation, cannot take this step.", "denied"],
    [409, "correction_already_pending", "A correction for this receipt is already waiting for a decision.", "conflict"],
    [409, "proposal_not_pending", "This proposal has already been decided or withdrawn.", "conflict"],
    [422, "validation_failed", "The request could not be accepted.", "validation"],
  ];
  try {
    for (const [status, error, message, kind] of cases) {
      globalThis.fetch = async () => json(status, { error, message });
      const r = await runProposeCorrection(PROPOSE, KEY);
      assert.deepEqual([r.ok, r.failure.kind, r.failure.message], [false, kind, message], error);
    }
    globalThis.fetch = async () => { throw new TypeError("network"); };
    const lost = await runDecideCorrection({ id: ID, decision: "approve" }, KEY);
    assert.deepEqual([lost.ok, lost.failure.kind], [false, "unavailable"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a payload signature reuses the key only for the same intent", () => {
  assert.deepEqual(proposeCorrectionSignature(PROPOSE), proposeCorrectionSignature({ ...PROPOSE }));
  assert.notDeepEqual(proposeCorrectionSignature(PROPOSE), proposeCorrectionSignature({ ...PROPOSE, receiptReference: "UTR-OTHER" }));
  assert.notDeepEqual(decideCorrectionSignature({ id: ID, decision: "approve" }), decideCorrectionSignature({ id: ID, decision: "reject" }));
});

test("the BFF validators accept the documented shapes and refuse anything else", () => {
  assert.ok(validateFeeCorrectionProposal(PROPOSAL));
  assert.ok(validateFeeCorrectionAdmin(ADMIN));
  assert.ok(validateFeeCorrectionAdmin({ ...ADMIN, confirmations: [{ ...ROW, pendingProposalId: null, correction: { receiptReference: "UTR-RIGHT", receivedOn: "2026-10-01", approvedBy: "BEE Programme", approvedAt: "2026-10-04T11:00:00Z" } }] }));
  assert.equal(validateFeeCorrectionProposal({ ...PROPOSAL, receiptReference: "UTR-WRONG", receivedOn: "2026-10-02" }), null, "a correction that changes nothing is not a correction");
  assert.equal(validateFeeCorrectionProposal({ ...PROPOSAL, state: "approved" }), null, "an approved correction names who decided it");
  assert.equal(validateFeeCorrectionProposal({ ...PROPOSAL, receiptReference: "bad;ref".repeat(20) }), null);
  assert.equal(validateFeeCorrectionProposal({ ...PROPOSAL, extra: 1 }), null);
  assert.equal(validateFeeCorrectionAdmin({ ...ADMIN, pending: [{ ...PROPOSAL, state: "rejected", decidedBy: "x" }] }), null, "a decided correction is not in the pending list");
  assert.equal(validateFeeCorrectionAdmin({ ...ADMIN, confirmations: [{ ...ROW, amountInr: "24000" }] }), null);
  assert.equal(validateFeeCorrectionAdmin({ ...ADMIN, confirmations: [{ ...ROW, correction: { receiptReference: "x" } }] }), null);
});

test("the status and code tables are the documented ones", () => {
  assert.ok(SPRING_FEE_CORRECTIONS.errors[403].includes("role_not_permitted") && !SPRING_FEE_CORRECTIONS.errors[403].includes("segregation_refused"));
  assert.deepEqual(SPRING_FEE_CORRECTION_PROPOSAL.successStatuses, [201]);
  assert.deepEqual(SPRING_FEE_CORRECTION_DECISION.successStatuses, [200]);
  assert.deepEqual(SPRING_FEE_CORRECTION_PROPOSAL.errors[409], ["correction_already_pending", "idempotency_key_conflict", "idempotency_in_progress"]);
  assert.deepEqual(SPRING_FEE_CORRECTION_DECISION.errors[409], ["proposal_not_pending", "idempotency_key_conflict", "idempotency_in_progress"]);
  assert.ok(SPRING_FEE_CORRECTION_PROPOSAL.errors[403].includes("segregation_refused") && SPRING_FEE_CORRECTION_DECISION.errors[403].includes("segregation_refused"));
});
