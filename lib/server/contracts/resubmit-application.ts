/**
 * Contract for POST /api/model-applications/{id}/resubmit. Per-feature module: the BFF's validator for the receipt and the
 * allowed status and code table. Keep it equal to the operation's x-error-codes in the OpenAPI artifact; the unit tests and
 * the live coverage gate fail when they drift.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const RESUMED_STATES = ["iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval"] as const;
export type ResumedState = (typeof RESUMED_STATES)[number];

export interface ResubmitApplicationReceipt {
  applicationId: string;
  reference: string;
  fromState: "returned";
  toState: ResumedState;
  version: number;
  ratingSuperseded: boolean;
  resubmittedAt: string;
}

export const validateResubmitApplicationReceipt: Validator<ResubmitApplicationReceipt> = (body) => {
  if (!exactKeys(body, ["applicationId", "reference", "fromState", "toState", "version", "ratingSuperseded", "resubmittedAt"])) return null;
  const b = body;
  const ok =
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    b.fromState === "returned" && (RESUMED_STATES as readonly unknown[]).includes(b.toState) &&
    Number.isInteger(b.version) && (b.version as number) >= 1 &&
    typeof b.ratingSuperseded === "boolean" &&
    // The two facts cannot disagree: it goes through rating again exactly when the rating was superseded.
    (b.ratingSuperseded === (b.toState === "rating")) &&
    isString(b.resubmittedAt) && !Number.isNaN(Date.parse(b.resubmittedAt));
  return ok ? (b as unknown as ResubmitApplicationReceipt) : null;
};

export const SPRING_RESUBMIT_APPLICATION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "no_write_scope", "brand_not_permitted", "not_returned"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress", "duplicate_model"],
  422: ["validation_failed", "idempotency_key_required", "test_report_required", "declared_efficiency_required", "test_date_invalid", "laboratory_not_accredited", "standard_not_available"],
  503: ["service_unavailable"],
};

export const SPRING_RESUBMIT_APPLICATION = { errors: SPRING_RESUBMIT_APPLICATION_ERRORS, validate: validateResubmitApplicationReceipt, successStatuses: [200] as const };
