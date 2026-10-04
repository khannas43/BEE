/**
 * Contract for POST /api/model-applications/{id}/rating (first slice step 5). Per-feature module: the BFF's validator for
 * the receipt and the allowed status and code table. Keep it equal to the operation's x-error-codes in the OpenAPI
 * artifact; the unit tests and the live coverage gate fail when they drift.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export interface RatingReceipt {
  applicationId: string;
  reference: string;
  fromState: "rating";
  toState: "director_review";
  version: number;
  ratingVersion: number;
  schemeKey: string;
  declaredIseer: string;
  verifiedIseer: string;
  stars: number;
  localDemoRating: true;
  computedAt: string;
}

export const validateRatingReceipt: Validator<RatingReceipt> = (body) => {
  if (!exactKeys(body, ["applicationId", "reference", "fromState", "toState", "version", "ratingVersion", "schemeKey", "declaredIseer", "verifiedIseer", "stars", "localDemoRating", "computedAt"])) return null;
  const b = body;
  const ok =
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    b.fromState === "rating" && b.toState === "director_review" &&
    Number.isInteger(b.version) && (b.version as number) >= 1 &&
    Number.isInteger(b.ratingVersion) && (b.ratingVersion as number) >= 1 &&
    isString(b.schemeKey) && isString(b.declaredIseer) && isString(b.verifiedIseer) &&
    Number.isInteger(b.stars) && (b.stars as number) >= 1 && (b.stars as number) <= 5 &&
    b.localDemoRating === true &&
    isString(b.computedAt) && !Number.isNaN(Date.parse(b.computedAt));
  return ok ? (b as unknown as RatingReceipt) : null;
};

export const SPRING_RATING_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"],
  422: ["validation_failed", "idempotency_key_required", "rule_not_available", "rating_below_threshold"],
  503: ["service_unavailable"],
};

export const SPRING_RATING = { errors: SPRING_RATING_ERRORS, validate: validateRatingReceipt, successStatuses: [200] as const };
