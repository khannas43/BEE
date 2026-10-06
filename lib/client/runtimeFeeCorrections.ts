/**
 * Browser client for the fee-confirmation correction routes, on the screen kit: read the confirmations and corrections, propose a
 * correction, decide one. Provisional local rules (the owner's assumption B11). Spring decides who may do what; this carries the request.
 */
import { type FetchLike, type ReadFailure, runtimeCommand, runtimeRead } from "@/lib/client/runtimeHttp";

export type CorrectionState = "pending" | "approved" | "rejected" | "withdrawn";
export type CorrectionDecision = "approve" | "reject" | "withdraw";

export type FeeConfirmationRow = {
  applicationId: string;
  reference: string;
  brandName: string;
  modelNumber: string;
  state: string;
  /** As Finance first confirmed it; never changed. */
  receiptReference: string;
  receivedOn: string;
  amountInr: string;
  confirmedBy: string;
  confirmedAt: string;
  /** The latest approved correction, whose values are in effect; null when none. */
  correction: { receiptReference: string; receivedOn: string; approvedBy: string; approvedAt: string } | null;
  pendingProposalId: string | null;
  /** Set when an approved reversal undid this confirmation: it stays as written and is history. */
  reversal: { reversedBy: string; reversedAt: string } | null;
  pendingReversalId: string | null;
};

export type FeeCorrectionProposal = {
  id: string;
  applicationId: string;
  reference: string;
  previousReceiptReference: string;
  previousReceivedOn: string;
  receiptReference: string;
  receivedOn: string;
  reason: string;
  state: CorrectionState;
  proposedBy: string;
  /** True when the signed-in person proposed it: they cannot approve or reject it. */
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

/** A proposal to reverse a fee confirmation recorded in error (BL-142, the owner's assumption B17). */
export type FeeReversalProposal = {
  id: string;
  applicationId: string;
  reference: string;
  reason: string;
  state: CorrectionState;
  proposedBy: string;
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

export type FeeCorrectionAdmin = {
  today: string;
  confirmations: FeeConfirmationRow[];
  pending: FeeCorrectionProposal[];
  decided: FeeCorrectionProposal[];
  reversalsPending: FeeReversalProposal[];
  reversalsDecided: FeeReversalProposal[];
};

export type FeeCorrectionsResult = { ok: true; admin: FeeCorrectionAdmin } | { ok: false; failure: ReadFailure };

export const FEE_CORRECTIONS_PATH = "/api/runtime/fee-corrections";
export const CORRECTION_PROPOSALS_PATH = "/api/runtime/fee-corrections/proposals";
export const REVERSALS_PATH = "/api/runtime/fee-corrections/reversals";
export const reversalDecisionPath = (id: string) => `/api/runtime/fee-corrections/reversals/${encodeURIComponent(id)}/decision`;
export const correctionDecisionPath = (id: string) => `/api/runtime/fee-corrections/proposals/${encodeURIComponent(id)}/decision`;

const parseAdmin = (body: unknown): FeeCorrectionAdmin | null =>
  body && typeof body === "object" && Array.isArray((body as FeeCorrectionAdmin).confirmations) && Array.isArray((body as FeeCorrectionAdmin).pending) &&
  Array.isArray((body as FeeCorrectionAdmin).reversalsPending) && Array.isArray((body as FeeCorrectionAdmin).reversalsDecided) ? (body as FeeCorrectionAdmin) : null;

const parseReversal = (body: unknown): FeeReversalProposal | null =>
  body && typeof body === "object" && "id" in body && "state" in body && "reason" in body && !("previousReceiptReference" in body) ? (body as FeeReversalProposal) : null;

const parseProposal = (body: unknown): FeeCorrectionProposal | null =>
  body && typeof body === "object" && "id" in body && "state" in body && "previousReceiptReference" in body ? (body as FeeCorrectionProposal) : null;

export async function readFeeCorrections(fetchImpl: FetchLike = fetch): Promise<FeeCorrectionsResult> {
  const r = await runtimeRead(FEE_CORRECTIONS_PATH, parseAdmin, fetchImpl);
  return r.ok ? { ok: true, admin: r.value } : r;
}

export type ProposeCorrectionInput = { applicationId: string; receiptReference: string; receivedOn: string; reason: string };

export function runProposeCorrection(p: ProposeCorrectionInput, idempotencyKey: string) {
  return runtimeCommand(CORRECTION_PROPOSALS_PATH, "POST", p, idempotencyKey, parseProposal);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const proposeCorrectionSignature = (p: ProposeCorrectionInput) => [p.applicationId, p.receiptReference, p.receivedOn, p.reason];

export type DecideCorrectionInput = { id: string; decision: CorrectionDecision; note?: string };

export function runDecideCorrection(p: DecideCorrectionInput, idempotencyKey: string) {
  return runtimeCommand(correctionDecisionPath(p.id), "POST", p.note ? { decision: p.decision, note: p.note } : { decision: p.decision }, idempotencyKey, parseProposal);
}

export const decideCorrectionSignature = (p: DecideCorrectionInput) => [p.id, p.decision, p.note ?? ""];

export type ProposeReversalInput = { applicationId: string; reason: string };

export function runProposeReversal(p: ProposeReversalInput, idempotencyKey: string) {
  return runtimeCommand(REVERSALS_PATH, "POST", p, idempotencyKey, parseReversal);
}

export const proposeReversalSignature = (p: ProposeReversalInput) => [p.applicationId, p.reason];

export function runDecideReversal(p: DecideCorrectionInput, idempotencyKey: string) {
  return runtimeCommand(reversalDecisionPath(p.id), "POST", p.note ? { decision: p.decision, note: p.note } : { decision: p.decision }, idempotencyKey, parseReversal);
}

export const decideReversalSignature = decideCorrectionSignature;
