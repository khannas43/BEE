/**
 * Contract for POST /api/model-applications/{id}/director-recommendation (first slice step 6). Per-feature module: the
 * BFF's validator for the receipt and the allowed status and code table. Keep it equal to the operation's x-error-codes in
 * the OpenAPI artifact; the unit tests and the live coverage gate fail when they drift.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export interface DirectorRecommendationReceipt {
  applicationId: string;
  reference: string;
  fromState: "director_review";
  toState: "secretary_approval" | "approved";
  version: number;
  note: string;
  directorFinal: boolean;
  recommendedAt: string;
}

export const validateDirectorRecommendationReceipt: Validator<DirectorRecommendationReceipt> = (body) => {
  if (!exactKeys(body, ["applicationId", "reference", "fromState", "toState", "version", "note", "directorFinal", "recommendedAt"])) return null;
  const b = body;
  const ok =
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    b.fromState === "director_review" && (b.toState === "secretary_approval" || b.toState === "approved") &&
    Number.isInteger(b.version) && (b.version as number) >= 1 &&
    isString(b.note) && typeof b.directorFinal === "boolean" &&
    // The two facts cannot disagree: the application is approved exactly when the recommendation was final.
    (b.directorFinal === (b.toState === "approved")) &&
    isString(b.recommendedAt) && !Number.isNaN(Date.parse(b.recommendedAt));
  return ok ? (b as unknown as DirectorRecommendationReceipt) : null;
};

export const SPRING_DIRECTOR_RECOMMENDATION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_DIRECTOR_RECOMMENDATION = { errors: SPRING_DIRECTOR_RECOMMENDATION_ERRORS, validate: validateDirectorRecommendationReceipt, successStatuses: [200] as const };
