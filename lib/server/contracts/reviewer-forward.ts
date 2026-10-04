/**
 * Contract for POST /api/model-applications/{id}/reviewer-forward (first slice step 4). Per-feature module: the BFF's
 * validator for the receipt and the allowed status and code table. Keep it equal to the operation's x-error-codes in the
 * OpenAPI artifact; the unit tests and the live coverage gate fail when they drift.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export interface ReviewerForwardReceipt {
  applicationId: string;
  reference: string;
  fromState: "bee_scrutiny";
  toState: "rating";
  version: number;
  note: string;
  forwardedAt: string;
}

export const validateReviewerForwardReceipt: Validator<ReviewerForwardReceipt> = (body) => {
  if (!exactKeys(body, ["applicationId", "reference", "fromState", "toState", "version", "note", "forwardedAt"])) return null;
  const b = body;
  const ok =
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    b.fromState === "bee_scrutiny" && b.toState === "rating" &&
    Number.isInteger(b.version) && (b.version as number) >= 1 &&
    isString(b.note) && isString(b.forwardedAt) && !Number.isNaN(Date.parse(b.forwardedAt));
  return ok ? (b as unknown as ReviewerForwardReceipt) : null;
};

export const SPRING_REVIEWER_FORWARD_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_REVIEWER_FORWARD = { errors: SPRING_REVIEWER_FORWARD_ERRORS, validate: validateReviewerForwardReceipt, successStatuses: [200] as const };
