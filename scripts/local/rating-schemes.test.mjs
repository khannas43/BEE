// Rating-scheme administration: the browser client and the BFF validators. No Spring or Keycloak.
// The rules themselves (two people, not in the past, later than every scheme there) are proven by RatingSchemeDatabaseTest, SpringContractTest and the live check.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RATING_SCHEMES_PATH, SCHEME_PROPOSALS_PATH, decideSchemeSignature, proposeSchemeSignature, readRatingSchemes, runDecideScheme, runProposeScheme, schemeDecisionPath,
} from "../../lib/client/runtimeRatingSchemes.ts";
import {
  SPRING_RATING_SCHEME_DECISION, SPRING_RATING_SCHEME_PROPOSAL, SPRING_RATING_SCHEMES, validateRatingSchemeAdmin, validateRatingSchemeProposal,
} from "../../lib/server/contracts/rating-schemes.ts";

const KEY = "0123456789abcdef01234567";
const ID = "3d6f0a8e-0000-4000-a000-0000000000f2";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const FIGURES = ["3.00", "3.40", "3.90", "4.40", "4.90"];
const PROPOSAL = {
  id: ID, categoryCode: "RAC", effectiveFrom: "2026-10-14", minIseer: FIGURES, sourceReference: "Circular 2026/14", reason: "Revised scheme", state: "pending",
  proposedBy: "BEE Admin", proposedByYou: true, proposedAt: "2026-10-04T10:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null, appliedScheme: null,
};
const SCHEME = {
  schemeKey: "RAC-ISEER-DEMO-1", categoryCode: "RAC", effectiveFrom: "2026-01-01", source: "Local seed", inForce: true,
  bands: ["3.30", "3.50", "4.00", "4.50", "5.00"].map((m, i) => ({ stars: i + 1, minIseer: m })),
};
const ADMIN = {
  today: "2026-10-04", categories: [{ code: "RAC", name: "Room air conditioner" }], schemes: [SCHEME], pending: [PROPOSAL],
  decided: [{ ...PROPOSAL, state: "approved", proposedByYou: false, decidedBy: "BEE Finance", decidedAt: "2026-10-04T11:00:00Z", appliedScheme: "RAC-ISEER-2" }],
};
const PROPOSE = { categoryCode: "RAC", effectiveFrom: "2026-10-14", minIseer: FIGURES, sourceReference: "Circular 2026/14", reason: "Revised scheme" };

test("the client reads the schemes, proposes with the key and the cookie, and decides on the proposal's own route", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (p, init) => {
    seen.push({ p, init });
    return p === RATING_SCHEMES_PATH ? json(200, ADMIN) : p === SCHEME_PROPOSALS_PATH ? json(201, PROPOSAL) : json(200, { ...PROPOSAL, state: "withdrawn", decidedBy: "BEE Admin" });
  };
  try {
    const read = await readRatingSchemes();
    assert.deepEqual([read.ok, read.admin.schemes.length, read.admin.pending[0].proposedByYou], [true, 1, true]);
    const created = await runProposeScheme(PROPOSE, KEY);
    assert.deepEqual([created.ok, created.value.state], [true, "pending"]);
    const post = seen.find((s) => s.p === SCHEME_PROPOSALS_PATH);
    assert.equal(post.init.method, "POST");
    assert.equal(post.init.credentials, "include");
    assert.equal(post.init.headers["Idempotency-Key"], KEY);
    assert.deepEqual(JSON.parse(post.init.body), PROPOSE);
    const decided = await runDecideScheme({ id: ID, decision: "withdraw" }, KEY);
    assert.equal(decided.ok, true);
    assert.deepEqual(JSON.parse(seen.find((s) => s.p === schemeDecisionPath(ID)).init.body), { decision: "withdraw" });
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
      const r = await runDecideScheme({ id: ID, decision: "approve" }, KEY);
      assert.deepEqual([r.ok, r.failure.kind, r.failure.message], [false, kind, message], error);
    }
    globalThis.fetch = async () => { throw new TypeError("network"); };
    const lost = await runProposeScheme(PROPOSE, KEY);
    assert.deepEqual([lost.ok, lost.failure.kind], [false, "unavailable"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a payload signature reuses the key only for the same intent", () => {
  assert.deepEqual(proposeSchemeSignature(PROPOSE), proposeSchemeSignature({ ...PROPOSE, minIseer: [...FIGURES] }));
  assert.notDeepEqual(proposeSchemeSignature(PROPOSE), proposeSchemeSignature({ ...PROPOSE, minIseer: ["3.00", "3.40", "3.90", "4.40", "4.95"] }));
  assert.notDeepEqual(decideSchemeSignature({ id: ID, decision: "approve" }), decideSchemeSignature({ id: ID, decision: "reject" }));
});

test("the BFF validators accept the documented shapes and refuse anything else", () => {
  assert.ok(validateRatingSchemeProposal(PROPOSAL));
  assert.ok(validateRatingSchemeAdmin(ADMIN));
  assert.equal(validateRatingSchemeProposal({ ...PROPOSAL, minIseer: ["3.00", "3.00", "3.90", "4.40", "4.90"] }), null, "the figures must rise");
  assert.equal(validateRatingSchemeProposal({ ...PROPOSAL, minIseer: ["3.00", "3.40", "3.90", "4.40"] }), null, "five figures");
  assert.equal(validateRatingSchemeProposal({ ...PROPOSAL, appliedScheme: "RAC-ISEER-2" }), null, "only an approved proposal names a scheme");
  assert.equal(validateRatingSchemeProposal({ ...PROPOSAL, state: "approved", decidedBy: "x", decidedAt: "2026-10-04T11:00:00Z", appliedScheme: null }), null);
  assert.equal(validateRatingSchemeProposal({ ...PROPOSAL, extra: 1 }), null);
  assert.equal(validateRatingSchemeAdmin({ ...ADMIN, pending: [{ ...PROPOSAL, state: "rejected", decidedBy: "x" }] }), null, "a decided proposal is not in the pending list");
  assert.equal(validateRatingSchemeAdmin({ ...ADMIN, schemes: [{ ...SCHEME, bands: SCHEME.bands.slice(0, 4) }] }), null);
  assert.equal(validateRatingSchemeAdmin({ ...ADMIN, schemes: [{ ...SCHEME, bands: SCHEME.bands.map((b, i) => ({ ...b, stars: 5 - i })) }] }), null, "bands run from 1 to 5 stars");
});

test("the status and code tables are the documented ones", () => {
  assert.ok(SPRING_RATING_SCHEMES.errors[403].includes("role_not_permitted") && !SPRING_RATING_SCHEMES.errors[403].includes("segregation_refused"));
  assert.deepEqual(SPRING_RATING_SCHEME_PROPOSAL.successStatuses, [201]);
  assert.deepEqual(SPRING_RATING_SCHEME_DECISION.successStatuses, [200]);
  assert.deepEqual(SPRING_RATING_SCHEME_DECISION.errors[409], ["proposal_not_pending", "effective_date_passed", "rule_conflict", "idempotency_key_conflict", "idempotency_in_progress"]);
  assert.ok(SPRING_RATING_SCHEME_DECISION.errors[403].includes("segregation_refused"));
});
