/**
 * Contract for POST /api/model-applications/{id}/reject. Per-feature module: the BFF's validator for the receipt and the
 * allowed status and code table. Keep it equal to the operation's x-error-codes in the OpenAPI artifact; the unit tests and
 * the live coverage gate fail when they drift.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const REJECT_FROM_STATES = ["iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval"] as const;
export type RejectFromState = (typeof REJECT_FROM_STATES)[number];

export interface StageRejectReceipt {
  applicationId: string;
  reference: string;
  fromState: RejectFromState;
  toState: "rejected";
  version: number;
  reason: string;
  rejectedAt: string;
}

export const validateStageRejectReceipt: Validator<StageRejectReceipt> = (body) => {
  if (!exactKeys(body, ["applicationId", "reference", "fromState", "toState", "version", "reason", "rejectedAt"])) return null;
  const b = body;
  const ok =
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    (REJECT_FROM_STATES as readonly unknown[]).includes(b.fromState) && b.toState === "rejected" &&
    Number.isInteger(b.version) && (b.version as number) >= 1 &&
    isString(b.reason) && isString(b.rejectedAt) && !Number.isNaN(Date.parse(b.rejectedAt));
  return ok ? (b as unknown as StageRejectReceipt) : null;
};

export const SPRING_STAGE_REJECT_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_STAGE_REJECT = { errors: SPRING_STAGE_REJECT_ERRORS, validate: validateStageRejectReceipt, successStatuses: [200] as const };
