/**
 * Contract for POST /api/model-applications/{id}/fee-confirmation (first slice step 2). Per-feature module: the BFF's
 * validator for the receipt and the allowed status and code table. Keep it equal to the operation's x-error-codes in the
 * OpenAPI artifact; the unit tests and the live coverage gate fail when they drift.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export interface FeeConfirmationReceipt {
  applicationId: string;
  reference: string;
  fromState: "fee_due";
  toState: "iame_scrutiny";
  version: number;
  receiptReference: string;
  amountInr: string;
  receivedOn: string;
  confirmedAt: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const validateFeeConfirmationReceipt: Validator<FeeConfirmationReceipt> = (body) => {
  if (!exactKeys(body, ["applicationId", "reference", "fromState", "toState", "version", "receiptReference", "amountInr", "receivedOn", "confirmedAt"])) return null;
  const b = body;
  const ok =
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    b.fromState === "fee_due" && b.toState === "iame_scrutiny" &&
    Number.isInteger(b.version) && (b.version as number) >= 1 &&
    isString(b.receiptReference) && isString(b.amountInr) &&
    isString(b.receivedOn) && DATE.test(b.receivedOn) &&
    isString(b.confirmedAt) && !Number.isNaN(Date.parse(b.confirmedAt));
  return ok ? (b as unknown as FeeConfirmationReceipt) : null;
};

export const SPRING_FEE_CONFIRMATION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress", "assignee_unavailable"],
  422: ["validation_failed", "idempotency_key_required", "amount_mismatch"],
  503: ["service_unavailable"],
};

export const SPRING_FEE_CONFIRMATION = { errors: SPRING_FEE_CONFIRMATION_ERRORS, validate: validateFeeConfirmationReceipt, successStatuses: [200] as const };
