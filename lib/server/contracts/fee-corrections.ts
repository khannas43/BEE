/**
 * Contract for the fee-correction routes: GET /api/fee-corrections, POST /api/fee-corrections/proposals and
 * POST /api/fee-corrections/proposals/{id}/decision. Per-feature module: the BFF's validators and allowed status and code tables.
 * Keep them equal to the operations' x-error-codes in the OpenAPI artifact. Provisional local rules (the owner's assumption B11).
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const CORRECTION_STATES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type CorrectionState = (typeof CORRECTION_STATES)[number];

export interface FeeConfirmationCorrection {
  receiptReference: string;
  receivedOn: string;
  approvedBy: string;
  approvedAt: string;
}

export interface FeeConfirmationRow {
  applicationId: string;
  reference: string;
  brandName: string;
  modelNumber: string;
  state: string;
  receiptReference: string;
  receivedOn: string;
  amountInr: string;
  confirmedBy: string;
  confirmedAt: string;
  correction: FeeConfirmationCorrection | null;
  pendingProposalId: string | null;
  /** Set when an approved reversal undid this confirmation (it stays as written and is history). */
  reversal: { reversedBy: string; reversedAt: string } | null;
  pendingReversalId: string | null;
}

export interface FeeReversalProposal {
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
}

export interface FeeCorrectionProposal {
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
  proposedByYou: boolean;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface FeeCorrectionAdmin {
  today: string;
  confirmations: FeeConfirmationRow[];
  pending: FeeCorrectionProposal[];
  decided: FeeCorrectionProposal[];
  reversalsPending: FeeReversalProposal[];
  reversalsDecided: FeeReversalProposal[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RECEIPT = /^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$/;
const isDate = (v: unknown): v is string => isString(v) && DATE.test(v) && !Number.isNaN(Date.parse(v));
const isInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));
const isReceipt = (v: unknown): v is string => isString(v) && v.length >= 1 && v.length <= 64;
const nullable = (v: unknown, ok: (x: unknown) => boolean) => v === null || ok(v);
const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

const validCorrection = (v: unknown): boolean => {
  const b = obj(v);
  return b !== null && exactKeys(b, ["receiptReference", "receivedOn", "approvedBy", "approvedAt"]) && isString(b.receiptReference) && RECEIPT.test(b.receiptReference) &&
    isDate(b.receivedOn) && isString(b.approvedBy) && isInstant(b.approvedAt);
};

const validConfirmation = (v: unknown): boolean => {
  const b = obj(v);
  return b !== null && exactKeys(b, ["applicationId", "reference", "brandName", "modelNumber", "state", "receiptReference", "receivedOn", "amountInr", "confirmedBy", "confirmedAt", "correction", "pendingProposalId", "reversal", "pendingReversalId"]) &&
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) && isString(b.brandName) && isString(b.modelNumber) && isString(b.state) &&
    isReceipt(b.receiptReference) && isDate(b.receivedOn) && isString(b.amountInr) && /^\d+\.\d{2}$/.test(b.amountInr) && isString(b.confirmedBy) && isInstant(b.confirmedAt) &&
    nullable(b.correction, validCorrection) && nullable(b.pendingProposalId, (x) => isString(x) && UUID.test(x)) &&
    nullable(b.reversal, validReversedMark) && nullable(b.pendingReversalId, (x) => isString(x) && UUID.test(x));
};

const validReversedMark = (v: unknown): boolean => {
  const b = obj(v);
  return b !== null && exactKeys(b, ["reversedBy", "reversedAt"]) && isString(b.reversedBy) && isInstant(b.reversedAt);
};

export const validateFeeReversalProposal: Validator<FeeReversalProposal> = (body) => {
  if (!exactKeys(body, ["id", "applicationId", "reference", "reason", "state", "proposedBy", "proposedByYou", "proposedAt", "decidedBy", "decidedAt", "decisionNote"])) return null;
  const b = body;
  const ok =
    isString(b.id) && UUID.test(b.id) && isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) && isString(b.reason) &&
    (CORRECTION_STATES as readonly unknown[]).includes(b.state) && isString(b.proposedBy) && typeof b.proposedByYou === "boolean" && isInstant(b.proposedAt) &&
    nullable(b.decidedBy, isString) && nullable(b.decidedAt, isInstant) && nullable(b.decisionNote, isString) &&
    (b.state === "pending") === (b.decidedBy === null);
  return ok ? (b as unknown as FeeReversalProposal) : null;
};

export const validateFeeCorrectionProposal: Validator<FeeCorrectionProposal> = (body) => {
  if (!exactKeys(body, ["id", "applicationId", "reference", "previousReceiptReference", "previousReceivedOn", "receiptReference", "receivedOn", "reason", "state",
    "proposedBy", "proposedByYou", "proposedAt", "decidedBy", "decidedAt", "decisionNote"])) return null;
  const b = body;
  const ok =
    isString(b.id) && UUID.test(b.id) && isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    isReceipt(b.previousReceiptReference) && isDate(b.previousReceivedOn) && isReceipt(b.receiptReference) && isDate(b.receivedOn) && isString(b.reason) &&
    (CORRECTION_STATES as readonly unknown[]).includes(b.state) && isString(b.proposedBy) && typeof b.proposedByYou === "boolean" && isInstant(b.proposedAt) &&
    nullable(b.decidedBy, isString) && nullable(b.decidedAt, isInstant) && nullable(b.decisionNote, isString) &&
    // Only a pending correction is undecided; a correction that changes nothing is not a correction.
    (b.state === "pending") === (b.decidedBy === null) && (b.receiptReference !== b.previousReceiptReference || b.receivedOn !== b.previousReceivedOn);
  return ok ? (b as unknown as FeeCorrectionProposal) : null;
};

export const validateFeeCorrectionAdmin: Validator<FeeCorrectionAdmin> = (body) => {
  if (!exactKeys(body, ["today", "confirmations", "pending", "decided", "reversalsPending", "reversalsDecided"])) return null;
  const b = body;
  const ok =
    isDate(b.today) && Array.isArray(b.confirmations) && b.confirmations.every(validConfirmation) &&
    Array.isArray(b.pending) && b.pending.every((p) => validateFeeCorrectionProposal(obj(p) ?? {}) !== null && (p as { state: string }).state === "pending") &&
    Array.isArray(b.decided) && b.decided.every((p) => validateFeeCorrectionProposal(obj(p) ?? {}) !== null && (p as { state: string }).state !== "pending") &&
    Array.isArray(b.reversalsPending) && b.reversalsPending.every((p) => validateFeeReversalProposal(obj(p) ?? {}) !== null && (p as { state: string }).state === "pending") &&
    Array.isArray(b.reversalsDecided) && b.reversalsDecided.every((p) => validateFeeReversalProposal(obj(p) ?? {}) !== null && (p as { state: string }).state !== "pending");
  return ok ? (b as unknown as FeeCorrectionAdmin) : null;
};

const IDEMPOTENCY_409 = ["idempotency_key_conflict", "idempotency_in_progress"] as const;

export const SPRING_FEE_CORRECTIONS_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted"],
  503: ["service_unavailable"],
};
export const SPRING_FEE_CORRECTION_PROPOSAL_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["correction_already_pending", "reversal_already_pending", ...IDEMPOTENCY_409],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_FEE_CORRECTION_DECISION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["proposal_not_pending", ...IDEMPOTENCY_409],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_FEE_REVERSAL_PROPOSAL_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["correction_already_pending", "reversal_already_pending", "reversal_not_possible", ...IDEMPOTENCY_409],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_FEE_REVERSAL_DECISION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["proposal_not_pending", "reversal_not_possible", ...IDEMPOTENCY_409],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_FEE_REVERSAL_PROPOSAL = { errors: SPRING_FEE_REVERSAL_PROPOSAL_ERRORS, validate: validateFeeReversalProposal, successStatuses: [201] as const };
export const SPRING_FEE_REVERSAL_DECISION = { errors: SPRING_FEE_REVERSAL_DECISION_ERRORS, validate: validateFeeReversalProposal, successStatuses: [200] as const };

export const SPRING_FEE_CORRECTIONS = { errors: SPRING_FEE_CORRECTIONS_ERRORS, validate: validateFeeCorrectionAdmin };
export const SPRING_FEE_CORRECTION_PROPOSAL = { errors: SPRING_FEE_CORRECTION_PROPOSAL_ERRORS, validate: validateFeeCorrectionProposal, successStatuses: [201] as const };
export const SPRING_FEE_CORRECTION_DECISION = { errors: SPRING_FEE_CORRECTION_DECISION_ERRORS, validate: validateFeeCorrectionProposal, successStatuses: [200] as const };
