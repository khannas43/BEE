/**
 * Contract for GET /api/public/verification (Spring) and GET /api/runtime/verification (the portal): the public certificate check.
 * Per-feature module: the BFF's validator and allowed status and code table. Keep it equal to the operation's x-error-codes in the
 * OpenAPI artifact. Decision D8 (the owner's assumption, not BEE's): only these fields are public.
 */
import { exactKeys, isString, type UpstreamErrors, type Validator } from "@/lib/server/apiContract";

export interface PublicVerification {
  registrationId: string;
  manufacturer: string;
  brandName: string;
  modelNumber: string;
  category: string;
  stars: number;
  verifiedIseer: string;
  validFrom: string;
  validTo: string;
  status: "valid" | "expired" | "not_yet_valid";
  localDemoCertificate: true;
}

export const REGISTRATION_ID = /^BEE\/[A-Z]{2,10}\/[0-9]{4}\/[0-9]{5,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const validatePublicVerification: Validator<PublicVerification> = (body) => {
  if (!exactKeys(body, ["registrationId", "manufacturer", "brandName", "modelNumber", "category", "stars", "verifiedIseer", "validFrom", "validTo", "status", "localDemoCertificate"])) return null;
  const b = body;
  const ok =
    isString(b.registrationId) && REGISTRATION_ID.test(b.registrationId) && isString(b.manufacturer) && isString(b.brandName) && isString(b.modelNumber) && isString(b.category) &&
    Number.isInteger(b.stars) && (b.stars as number) >= 1 && (b.stars as number) <= 5 && isString(b.verifiedIseer) &&
    isString(b.validFrom) && DATE.test(b.validFrom) && isString(b.validTo) && DATE.test(b.validTo) && b.validTo > b.validFrom &&
    (b.status === "valid" || b.status === "expired" || b.status === "not_yet_valid") && b.localDemoCertificate === true;
  return ok ? (b as unknown as PublicVerification) : null;
};

/** Spring's public route answers only these; there is no sign-in, so no 401 or 403. */
export const SPRING_PUBLIC_VERIFICATION_ERRORS: UpstreamErrors = {
  404: ["not_found"],
  422: ["validation_failed"],
  429: ["rate_limited"],
  503: ["service_unavailable"],
};

export const SPRING_PUBLIC_VERIFICATION = { errors: SPRING_PUBLIC_VERIFICATION_ERRORS, validate: validatePublicVerification };
