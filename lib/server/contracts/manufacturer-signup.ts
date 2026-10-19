import { exactKeys, isString, UUID, type UpstreamErrors, type Validator } from "@/lib/server/apiContract";

const isUuid = (v: unknown): v is string => isString(v) && UUID.test(v);

export interface ManufacturerSignupCreated {
  username: string;
  accountId: string;
  organisationId: string;
  applicationId: string;
  emailVerifiedSimulated: true;
  mobileVerifiedSimulated: true;
  verification: "simulated";
}

export const validateManufacturerSignupCreated: Validator<ManufacturerSignupCreated> = (body) => {
  if (!exactKeys(body, ["username", "accountId", "organisationId", "applicationId", "emailVerifiedSimulated", "mobileVerifiedSimulated", "verification"])) {
    return null;
  }
  const b = body;
  const ok =
    isString(b.username) &&
    isUuid(b.accountId) &&
    isUuid(b.organisationId) &&
    isUuid(b.applicationId) &&
    b.emailVerifiedSimulated === true &&
    b.mobileVerifiedSimulated === true &&
    b.verification === "simulated";
  return ok ? (b as unknown as ManufacturerSignupCreated) : null;
};

export const SPRING_PUBLIC_MANUFACTURER_SIGNUP_ERRORS: UpstreamErrors = {
  409: ["registration_not_available", "idempotency_key_conflict"],
  422: ["validation_failed", "idempotency_key_required"],
  429: ["rate_limited"],
  503: ["service_unavailable"],
};

export const SPRING_PUBLIC_MANUFACTURER_SIGNUP = {
  errors: SPRING_PUBLIC_MANUFACTURER_SIGNUP_ERRORS,
  validate: validateManufacturerSignupCreated,
  successStatuses: [201] as const,
};
