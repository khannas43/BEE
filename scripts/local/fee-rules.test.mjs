// Fee-rule administration: the browser client and the BFF validators. No Spring or Keycloak.
// The rules themselves (two people, not in the past, close-and-start) are proven by FeeRuleDatabaseTest, SpringContractTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FEE_PROPOSALS_PATH, FEE_RULES_PATH, decideFeeRuleSignature, feeDecisionPath, proposeFeeRuleSignature, readFeeRules, runDecideFeeRule, runProposeFeeRule,
} from "../../lib/client/runtimeFeeRules.ts";
import {
  SPRING_FEE_RULE_DECISION, SPRING_FEE_RULE_PROPOSAL, SPRING_FEE_RULES, validateFeeRuleAdmin, validateFeeRuleProposal,
} from "../../lib/server/contracts/fee-rules.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-0000000000f1";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const PROPOSAL = {
  id: ID, ruleKey: "RAC:new_model", categoryCode: "RAC", applicationType: "new_model", amountInr: "26000.00", taxRatePercent: "18.00", effectiveFrom: "2026-10-14",
  sourceReference: "Circular 2026/14", reason: "Revised fee", state: "pending", proposedBy: "BEE Admin", proposedByYou: true, proposedAt: "2026-10-04T10:00:00Z",
  decidedBy: null, decidedAt: null, decisionNote: null, appliedVersion: null,
};
const VERSION = { version: 2, effectiveFrom: "2026-10-01", effectiveTo: null, amountInr: "24000.00", taxRatePercent: "0.00", verification: "provisional", source: "Local seed", inForce: true };
const ADMIN = {
  today: "2026-10-04", applicationTypes: [{ code: "new_model", label: "New model" }], categories: [{ code: "RAC", name: "Room air conditioner" }],
  rules: [{ ruleKey: "RAC:new_model", categoryCode: "RAC", applicationType: "new_model", versions: [VERSION] }], pending: [PROPOSAL],
  decided: [{ ...PROPOSAL, state: "approved", proposedByYou: false, decidedBy: "BEE Finance", decidedAt: "2026-10-04T11:00:00Z", appliedVersion: 3 }],
};
const PROPOSE = { categoryCode: "RAC", applicationType: "new_model", amountInr: "26000.00", taxRatePercent: "18.00", effectiveFrom: "2026-10-14", sourceReference: "Circular 2026/14", reason: "Revised fee" };

test("the client reads the rules, proposes with the key and the cookie, and decides on the proposal's own route", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (p, init) => {
    seen.push({ p, init });
    return p === FEE_RULES_PATH ? json(200, ADMIN) : p === FEE_PROPOSALS_PATH ? json(201, PROPOSAL) : json(200, { ...PROPOSAL, state: "withdrawn", decidedBy: "BEE Admin" });
  };
  try {
    const read = await readFeeRules();
    assert.deepEqual([read.ok, read.admin.rules.length, read.admin.pending[0].proposedByYou], [true, 1, true]);
    const created = await runProposeFeeRule(PROPOSE, KEY);
    assert.deepEqual([created.ok, created.value.state], [true, "pending"]);
    const post = seen.find((s) => s.p === FEE_PROPOSALS_PATH);
    assert.equal(post.init.method, "POST");
    assert.equal(post.init.credentials, "include");
    assert.equal(post.init.headers["Idempotency-Key"], KEY);
    assert.deepEqual(JSON.parse(post.init.body), PROPOSE);
    const decided = await runDecideFeeRule({ id: ID, decision: "withdraw" }, KEY);
    assert.equal(decided.ok, true);
    const d = seen.find((s) => s.p === feeDecisionPath(ID));
    assert.deepEqual(JSON.parse(d.init.body), { decision: "withdraw" });
    const withNote = await runDecideFeeRule({ id: ID, decision: "reject", note: "not now" }, KEY);
    assert.equal(withNote.ok, true);
    assert.deepEqual(JSON.parse(seen[seen.length - 1].init.body), { decision: "reject", note: "not now" });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("each documented refusal is a typed failure with the contract's message", async () => {
  const realFetch = globalThis.fetch;
  const cases = [
    [403, "role_not_permitted", "This role cannot perform this action.", "denied"],
    [403, "segregation_refused", "A person who acted at another stage of this application, or its own organisation, cannot take this step.", "denied"],
    [409, "proposal_not_pending", "This proposal has already been decided or withdrawn.", "conflict"],
    [409, "effective_date_passed", "The date this rule was to start has passed; propose it again with a later date.", "conflict"],
    [409, "rule_conflict", "This rule cannot start on that date because of the rules already in place.", "conflict"],
    [422, "validation_failed", "The request could not be accepted.", "validation"],
  ];
  try {
    for (const [status, error, message, kind] of cases) {
      globalThis.fetch = async () => json(status, { error, message });
      const r = await runDecideFeeRule({ id: ID, decision: "approve" }, KEY);
      assert.deepEqual([r.ok, r.failure.kind, r.failure.message], [false, kind, message], error);
    }
    globalThis.fetch = async () => { throw new TypeError("network"); };
    const lost = await runProposeFeeRule(PROPOSE, KEY);
    assert.deepEqual([lost.ok, lost.failure.kind], [false, "unavailable"]);
    const read = await (async () => { globalThis.fetch = async () => json(403, { error: "role_not_permitted", message: "This role cannot perform this action." }); return readFeeRules(); })();
    assert.equal(read.ok, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a payload signature reuses the key only for the same intent", () => {
  assert.deepEqual(proposeFeeRuleSignature(PROPOSE), proposeFeeRuleSignature({ ...PROPOSE }));
  assert.notDeepEqual(proposeFeeRuleSignature(PROPOSE), proposeFeeRuleSignature({ ...PROPOSE, amountInr: "27000.00" }));
  assert.notDeepEqual(decideFeeRuleSignature({ id: ID, decision: "approve" }), decideFeeRuleSignature({ id: ID, decision: "reject" }));
});

test("the BFF validators accept the documented shapes and refuse anything else", () => {
  assert.ok(validateFeeRuleProposal(PROPOSAL));
  assert.ok(validateFeeRuleAdmin(ADMIN));
  // A proposal that names an applied version without being approved, or an approved one without it, is not a proposal.
  assert.equal(validateFeeRuleProposal({ ...PROPOSAL, appliedVersion: 3 }), null);
  assert.equal(validateFeeRuleProposal({ ...PROPOSAL, state: "approved", decidedBy: "x", decidedAt: "2026-10-04T11:00:00Z", appliedVersion: null }), null);
  assert.equal(validateFeeRuleProposal({ ...PROPOSAL, ruleKey: "RAC:renewal" }), null, "the rule key is the category and type");
  assert.equal(validateFeeRuleProposal({ ...PROPOSAL, extra: 1 }), null);
  assert.equal(validateFeeRuleAdmin({ ...ADMIN, pending: [{ ...PROPOSAL, state: "rejected", decidedBy: "x" }] }), null, "a decided proposal is not in the pending list");
  assert.equal(validateFeeRuleAdmin({ ...ADMIN, rules: [{ ...ADMIN.rules[0], versions: [{ ...VERSION, amountInr: "24000" }] }] }), null);
  assert.equal(validateFeeRuleAdmin({ ...ADMIN, today: "yesterday" }), null);
});

test("the status and code tables are the documented ones", () => {
  assert.ok(SPRING_FEE_RULES.errors[403].includes("role_not_permitted") && !SPRING_FEE_RULES.errors[403].includes("segregation_refused"));
  assert.deepEqual(SPRING_FEE_RULE_PROPOSAL.successStatuses, [201]);
  assert.deepEqual(SPRING_FEE_RULE_DECISION.successStatuses, [200]);
  assert.deepEqual(SPRING_FEE_RULE_DECISION.errors[409], ["proposal_not_pending", "effective_date_passed", "rule_conflict", "idempotency_key_conflict", "idempotency_in_progress"]);
  assert.ok(SPRING_FEE_RULE_DECISION.errors[403].includes("segregation_refused"));
});
