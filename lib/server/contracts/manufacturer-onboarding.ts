/**
 * BFF validators for Spring `/api/manufacturer-onboarding` (database authority).
 * Fee ₹5,000 from `REG:manufacturer_onboarding`; states include `automatic_checks_failed`;
 * `rejected` (pre-activation director reject) and `revoked` (post-activation director resolve) are distinct.
 */
import {
  exactKeys,
  isString,
  RESOLVER_DENIALS,
  SPRING_READ_ERRORS,
  UUID,
  type UpstreamErrors,
  type Validator,
} from "@/lib/server/apiContract";

export const MANUFACTURER_ONBOARDING_STATES = [
  "draft",
  "submitted",
  "automatic_checks_failed",
  "director_review",
  "active_observation",
  "active",
  "on_hold",
  "rejected",
  "revoked",
] as const;

export interface ManufacturerOnboardingItem {
  id: string;
  reference: string;
  organisationId: string;
  legalName: string;
  state: (typeof MANUFACTURER_ONBOARDING_STATES)[number];
  version: number;
  tradeLicenceUploaded: boolean;
  permitteeNumber?: string;
  observationEndsOn?: string;
  createdAt: string;
}

export interface ManufacturerOnboardingList {
  items: ManufacturerOnboardingItem[];
  count: number;
  authority: "spring-database";
}

export interface ManufacturerOnboardingSubmitPreview {
  applicationId: string;
  state: (typeof MANUFACTURER_ONBOARDING_STATES)[number];
  version: number;
  tradeLicenceUploaded: boolean;
  expectedFee: { amountInr: string; feeRuleKey: string; feeRuleVersion: number };
}

const isUuid = (v: unknown): v is string => isString(v) && UUID.test(v);
const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
const isState = (v: unknown) => (MANUFACTURER_ONBOARDING_STATES as readonly unknown[]).includes(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const validateManufacturerOnboardingItem: Validator<ManufacturerOnboardingItem> = (body) => {
  if (!exactKeys(body, ["id", "reference", "organisationId", "legalName", "state", "version", "tradeLicenceUploaded", "createdAt"], ["permitteeNumber", "observationEndsOn"])) {
    return null;
  }
  const b = body;
  const ok =
    isUuid(b.id) &&
    isString(b.reference) &&
    isUuid(b.organisationId) &&
    isString(b.legalName) &&
    b.legalName.length >= 1 &&
    isState(b.state) &&
    isCount(b.version) &&
    typeof b.tradeLicenceUploaded === "boolean" &&
    isString(b.createdAt) &&
    !Number.isNaN(Date.parse(b.createdAt)) &&
    (b.permitteeNumber === undefined || (isString(b.permitteeNumber) && b.permitteeNumber.length >= 1)) &&
    (b.observationEndsOn === undefined || (isString(b.observationEndsOn) && DATE.test(b.observationEndsOn)));
  return ok ? (b as unknown as ManufacturerOnboardingItem) : null;
};

export const validateManufacturerOnboardingList: Validator<ManufacturerOnboardingList> = (body) => {
  if (!exactKeys(body, ["items", "count", "authority"])) return null;
  const b = body;
  const ok =
    b.authority === "spring-database" &&
    Array.isArray(b.items) &&
    b.items.every((i) => validateManufacturerOnboardingItem(i) !== null) &&
    b.count === b.items.length;
  return ok ? (b as unknown as ManufacturerOnboardingList) : null;
};

const WRITE = [...RESOLVER_DENIALS, "no_write_scope"] as const;
const IDEMPOTENCY = ["idempotency_key_conflict", "idempotency_in_progress"] as const;

export const SPRING_MANUFACTURER_ONBOARDING_LIST_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "no_read_scope"],
  503: ["service_unavailable"],
};
export const SPRING_MANUFACTURER_ONBOARDING_READ_ERRORS: UpstreamErrors = { ...SPRING_READ_ERRORS, 404: ["not_found"] };
export const SPRING_MANUFACTURER_ONBOARDING_CREATE_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: WRITE,
  409: [...IDEMPOTENCY],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_MANUFACTURER_ONBOARDING_PATCH_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...WRITE, "not_editable"],
  404: ["not_found"],
  409: ["version_conflict", ...IDEMPOTENCY],
  422: ["validation_failed"],
  503: ["service_unavailable"],
};
export const validateManufacturerOnboardingSubmitPreview: Validator<ManufacturerOnboardingSubmitPreview> = (body) => {
  if (!exactKeys(body, ["applicationId", "state", "version", "tradeLicenceUploaded", "expectedFee"])) return null;
  const b = body;
  const fee = b.expectedFee;
  if (!exactKeys(fee, ["amountInr", "feeRuleKey", "feeRuleVersion"])) return null;
  const ok =
    isUuid(b.applicationId) &&
    isState(b.state) &&
    isCount(b.version) &&
    typeof b.tradeLicenceUploaded === "boolean" &&
    isString(fee.amountInr) &&
    isString(fee.feeRuleKey) &&
    isCount(fee.feeRuleVersion);
  return ok ? (b as unknown as ManufacturerOnboardingSubmitPreview) : null;
};

export const SPRING_MANUFACTURER_ONBOARDING_PREVIEW_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...WRITE, "not_submittable"],
  404: ["not_found"],
  422: ["rule_not_available"],
  503: ["service_unavailable"],
};
export const SPRING_MANUFACTURER_ONBOARDING_SUBMIT_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...WRITE, "organisation_not_eligible", "not_submittable"],
  404: ["not_found"],
  409: ["version_conflict", ...IDEMPOTENCY],
  422: ["validation_failed", "idempotency_key_required", "rule_not_available"],
  503: ["service_unavailable"],
};

export const SPRING_MANUFACTURER_ONBOARDING_LIST = { errors: SPRING_MANUFACTURER_ONBOARDING_LIST_ERRORS, validate: validateManufacturerOnboardingList };
export const SPRING_MANUFACTURER_ONBOARDING_READ = { errors: SPRING_MANUFACTURER_ONBOARDING_READ_ERRORS, validate: validateManufacturerOnboardingItem };
export const SPRING_MANUFACTURER_ONBOARDING_CREATE = {
  errors: SPRING_MANUFACTURER_ONBOARDING_CREATE_ERRORS,
  validate: validateManufacturerOnboardingItem,
  successStatuses: [201] as const,
};
export const SPRING_MANUFACTURER_ONBOARDING_PATCH = {
  errors: SPRING_MANUFACTURER_ONBOARDING_PATCH_ERRORS,
  validate: validateManufacturerOnboardingItem,
  successStatuses: [200] as const,
};
export const SPRING_MANUFACTURER_ONBOARDING_PREVIEW = {
  errors: SPRING_MANUFACTURER_ONBOARDING_PREVIEW_ERRORS,
  validate: validateManufacturerOnboardingSubmitPreview,
};
export const SPRING_MANUFACTURER_ONBOARDING_SUBMIT = {
  errors: SPRING_MANUFACTURER_ONBOARDING_SUBMIT_ERRORS,
  validate: validateManufacturerOnboardingItem,
  successStatuses: [200] as const,
};
