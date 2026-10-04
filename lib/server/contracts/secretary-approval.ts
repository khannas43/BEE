/**
 * Contract for POST /api/model-applications/{id}/secretary-approval (first slice step 7). Per-feature module: the BFF's
 * validator for the receipt and the allowed status and code table. Keep it equal to the operation's x-error-codes in the
 * OpenAPI artifact; the unit tests and the live coverage gate fail when they drift.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export interface SecretaryApprovalReceipt {
  applicationId: string;
  reference: string;
  fromState: "secretary_approval";
  toState: "approved";
  version: number;
  note: string;
  approvedAt: string;
}

export const validateSecretaryApprovalReceipt: Validator<SecretaryApprovalReceipt> = (body) => {
  if (!exactKeys(body, ["applicationId", "reference", "fromState", "toState", "version", "note", "approvedAt"])) return null;
  const b = body;
  const ok =
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) &&
    b.fromState === "secretary_approval" && b.toState === "approved" &&
    Number.isInteger(b.version) && (b.version as number) >= 1 &&
    isString(b.note) && isString(b.approvedAt) && !Number.isNaN(Date.parse(b.approvedAt));
  return ok ? (b as unknown as SecretaryApprovalReceipt) : null;
};

export const SPRING_SECRETARY_APPROVAL_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_SECRETARY_APPROVAL = { errors: SPRING_SECRETARY_APPROVAL_ERRORS, validate: validateSecretaryApprovalReceipt, successStatuses: [200] as const };
