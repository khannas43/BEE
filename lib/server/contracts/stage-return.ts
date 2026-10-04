/**
 * Contract for POST /api/model-applications/{id}/return. Per-feature module: the BFF's validator for the receipt and the
 * allowed status and code table. Keep it equal to the operation's x-error-codes in the OpenAPI artifact; the unit tests and
 * the live coverage gate fail when they drift.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const RETURN_FROM_STATES = ["iame_scrutiny", "bee_scrutiny", "director_review", "secretary_approval"] as const;
export type ReturnFromState = (typeof RETURN_FROM_STATES)[number];

export interface StageReturnReceipt {
  applicationId: string;
  reference: string;
  fromState: ReturnFromState;
  toState: "returned";
  version: number;
  reason: string;
  returnedAt: string;
}

export const validateStageReturnReceipt: Validator<StageReturnReceipt> = (body) => {
  if (!exactKeys(body, ["applicationId", "reference", "fromState", "toState", "version", "reason", "returnedAt"])) return null;
  const b = body;
  const ok =
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    (RETURN_FROM_STATES as readonly unknown[]).includes(b.fromState) && b.toState === "returned" &&
    Number.isInteger(b.version) && (b.version as number) >= 1 &&
    isString(b.reason) && isString(b.returnedAt) && !Number.isNaN(Date.parse(b.returnedAt));
  return ok ? (b as unknown as StageReturnReceipt) : null;
};

export const SPRING_STAGE_RETURN_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_STAGE_RETURN = { errors: SPRING_STAGE_RETURN_ERRORS, validate: validateStageReturnReceipt, successStatuses: [200] as const };
