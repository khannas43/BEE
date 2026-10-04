/**
 * Browser client for the fee-rule administration routes, on the screen kit: read the fee rules and proposals, propose a rule,
 * decide a proposal. Provisional local rules (the owner's assumptions A1 and C1), not BEE rules. Spring decides who may do
 * what; this only carries the request.
 */
import { type FetchLike, type ReadFailure, runtimeCommand, runtimeRead } from "@/lib/client/runtimeHttp";

export type ProposalState = "pending" | "approved" | "rejected" | "withdrawn";
export type Decision = "approve" | "reject" | "withdraw";

export type FeeRuleVersion = {
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  amountInr: string;
  taxRatePercent: string;
  verification: "synthetic" | "provisional" | "verified";
  source: string;
  inForce: boolean;
};

export type FeeRule = { ruleKey: string; categoryCode: string; applicationType: string; versions: FeeRuleVersion[] };

export type FeeRuleProposal = {
  id: string;
  ruleKey: string;
  categoryCode: string;
  applicationType: string;
  amountInr: string;
  taxRatePercent: string;
  effectiveFrom: string;
  sourceReference: string;
  reason: string;
  state: ProposalState;
  proposedBy: string;
  /** True when the signed-in person proposed it: they cannot approve or reject it. */
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  appliedVersion: number | null;
};

export type FeeRuleAdmin = {
  today: string;
  applicationTypes: { code: string; label: string }[];
  categories: { code: string; name: string }[];
  rules: FeeRule[];
  pending: FeeRuleProposal[];
  decided: FeeRuleProposal[];
};

export type FeeRulesResult = { ok: true; admin: FeeRuleAdmin } | { ok: false; failure: ReadFailure };

export const FEE_RULES_PATH = "/api/runtime/fee-rules";
export const FEE_PROPOSALS_PATH = "/api/runtime/fee-rules/proposals";
export const feeDecisionPath = (id: string) => `/api/runtime/fee-rules/proposals/${encodeURIComponent(id)}/decision`;

const parseAdmin = (body: unknown): FeeRuleAdmin | null =>
  body && typeof body === "object" && Array.isArray((body as FeeRuleAdmin).rules) && Array.isArray((body as FeeRuleAdmin).pending) ? (body as FeeRuleAdmin) : null;

const parseProposal = (body: unknown): FeeRuleProposal | null =>
  body && typeof body === "object" && "id" in body && "state" in body && "effectiveFrom" in body ? (body as FeeRuleProposal) : null;

export async function readFeeRules(fetchImpl: FetchLike = fetch): Promise<FeeRulesResult> {
  const r = await runtimeRead(FEE_RULES_PATH, parseAdmin, fetchImpl);
  return r.ok ? { ok: true, admin: r.value } : r;
}

export type ProposeFeeRuleInput = {
  categoryCode: string;
  applicationType: string;
  amountInr: string;
  taxRatePercent: string;
  effectiveFrom: string;
  sourceReference: string;
  reason: string;
};

export function runProposeFeeRule(p: ProposeFeeRuleInput, idempotencyKey: string) {
  return runtimeCommand(FEE_PROPOSALS_PATH, "POST", p, idempotencyKey, parseProposal);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const proposeFeeRuleSignature = (p: ProposeFeeRuleInput) => [p.categoryCode, p.applicationType, p.amountInr, p.taxRatePercent, p.effectiveFrom, p.sourceReference, p.reason];

export type DecideFeeRuleInput = { id: string; decision: Decision; note?: string };

export function runDecideFeeRule(p: DecideFeeRuleInput, idempotencyKey: string) {
  return runtimeCommand(feeDecisionPath(p.id), "POST", p.note ? { decision: p.decision, note: p.note } : { decision: p.decision }, idempotencyKey, parseProposal);
}

export const decideFeeRuleSignature = (p: DecideFeeRuleInput) => [p.id, p.decision, p.note ?? ""];
