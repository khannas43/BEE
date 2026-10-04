/**
 * Contract for POST /api/model-applications/{id}/iame-recommendation (first slice step 3). Per-feature module: the BFF's
 * validator for the receipt and the allowed status and code table. Keep it equal to the operation's x-error-codes in the
 * OpenAPI artifact; the unit tests and the live coverage gate fail when they drift.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export interface IameRecommendationReceipt {
  applicationId: string;
  reference: string;
  fromState: "iame_scrutiny";
  toState: "bee_scrutiny";
  version: number;
  verification: "verified" | "not_verified";
  note: string;
  recommendedAt: string;
}

export const validateIameRecommendationReceipt: Validator<IameRecommendationReceipt> = (body) => {
  if (!exactKeys(body, ["applicationId", "reference", "fromState", "toState", "version", "verification", "note", "recommendedAt"])) return null;
  const b = body;
  const ok =
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    b.fromState === "iame_scrutiny" && b.toState === "bee_scrutiny" &&
    Number.isInteger(b.version) && (b.version as number) >= 1 &&
    (b.verification === "verified" || b.verification === "not_verified") && isString(b.note) &&
    isString(b.recommendedAt) && !Number.isNaN(Date.parse(b.recommendedAt));
  return ok ? (b as unknown as IameRecommendationReceipt) : null;
};

export const SPRING_IAME_RECOMMENDATION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress", "assignee_unavailable"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_IAME_RECOMMENDATION = { errors: SPRING_IAME_RECOMMENDATION_ERRORS, validate: validateIameRecommendationReceipt, successStatuses: [200] as const };
