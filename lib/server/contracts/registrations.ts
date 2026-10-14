/**
 * Contract for the brand and agency registration routes (WP04.2b-1): the BFF's validators for each response and the allowed status
 * and code table per operation. Keep it equal to the operations' x-error-codes in the OpenAPI artifact; the unit tests and the live
 * coverage gate fail when they drift. Provisional local rules, not BEE rules.
 */
import {
  exactKeys, isString, RESOLVER_DENIALS, SPRING_READ_ERRORS, validateSubmissionFee, type SubmissionFee, type UpstreamErrors, UUID, type Validator,
} from "@/lib/server/apiContract";
import { SPRING_FEE_CONFIRMATION_ERRORS } from "@/lib/server/contracts/fee-confirmation";

export const REGISTRATION_STATES = ["draft", "fee_due", "programme_review", "director_approval", "approved", "returned", "rejected"] as const;
export type RegistrationState = (typeof REGISTRATION_STATES)[number];
export type RegistrationKind = "brand" | "agency";

export interface Registration {
  id: string;
  reference: string;
  kind: RegistrationKind;
  organisation: string;
  brandName: string;
  brandId?: string;
  validFrom?: string;
  validTo?: string;
  state: RegistrationState;
  version: number;
  tradeLicenceUploaded: boolean;
  submissionFee?: SubmissionFee;
  /** The register entry an approved request made (WP04.2b-2). */
  registeredBrandId?: string;
  registeredAuthorisationId?: string;
  /** Steps after filing, oldest first; present on a single read only. The applicant sees decisions, reviewers see every step. */
  trail?: RegistrationTrailItem[];
}

export const REGISTRATION_ACTIONS = ["recommend", "return", "reject", "approve", "resubmit"] as const;
export type RegistrationAction = (typeof REGISTRATION_ACTIONS)[number];
const TRAIL_ACTIONS = ["confirm_fee", ...REGISTRATION_ACTIONS] as const;

export interface RegistrationTrailItem {
  action: (typeof TRAIL_ACTIONS)[number];
  actorRole: string;
  fromState: RegistrationState;
  toState: RegistrationState;
  note?: string;
  at: string;
}

export interface RegistrationTransitionReceipt {
  registrationId: string;
  reference: string;
  action: RegistrationAction;
  fromState: RegistrationState;
  toState: RegistrationState;
  version: number;
  actedAt: string;
  registeredBrandId?: string;
  registeredAuthorisationId?: string;
}

export interface RegistrationList {
  items: Registration[];
  count: number;
  authority: "spring-database";
}

export interface RegistrationBrand {
  brandId: string;
  brandName: string;
  principalOrganisation: string;
}

export interface RegistrationBrandList {
  items: RegistrationBrand[];
  count: number;
  authority: "spring-database";
}

export const REGISTRATION_GATE_CODES = ["trade_licence_uploaded", "start_date_set", "brand_active", "brand_name_free"] as const;

export interface RegistrationSubmitPreview {
  ready: boolean;
  version: number;
  intakeNote: string;
  gates: { code: (typeof REGISTRATION_GATE_CODES)[number]; met: boolean }[];
  submissionFee?: SubmissionFee;
}

export interface RegistrationFeeReceipt {
  registrationId: string;
  reference: string;
  fromState: "fee_due";
  toState: "programme_review";
  version: number;
  receiptReference: string;
  amountInr: string;
  receivedOn: string;
  confirmedAt: string;
}

export interface RegistrationDocumentVersion {
  id: string;
  versionNumber: number;
  contentSha256: string;
  sizeBytes: number;
  mediaType: "application/pdf";
  originalFilename: string;
  label: string;
  uploadedByAccountId: string;
  uploadedAt: string;
  verificationStatus: "pending_local_verification";
}

export interface RegistrationDocument {
  id: string;
  documentKind: "trade_licence";
  verificationStatus: "pending_local_verification";
  verificationNote: string;
  versions: RegistrationDocumentVersion[];
  latestVersion?: RegistrationDocumentVersion;
}

export interface RegistrationDocumentList {
  items: RegistrationDocument[];
  count: number;
  authority: "spring-database";
  verificationNote: string;
  localStore: true;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const PENDING = "pending_local_verification";
const isUuid = (v: unknown): v is string => isString(v) && UUID.test(v);
const isDate = (v: unknown): v is string => isString(v) && DATE.test(v);
const isCount = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;

const isState = (v: unknown) => (REGISTRATION_STATES as readonly unknown[]).includes(v);

function validTrailItem(i: unknown): boolean {
  if (!exactKeys(i, ["action", "actorRole", "fromState", "toState", "at"], ["note"])) return false;
  const t = i as Record<string, unknown>;
  return (TRAIL_ACTIONS as readonly unknown[]).includes(t.action) && isString(t.actorRole) && isState(t.fromState) && isState(t.toState) &&
    isString(t.at) && !Number.isNaN(Date.parse(t.at)) && (t.note === undefined || (isString(t.note) && t.note.length >= 1 && t.note.length <= 500));
}

export const validateRegistration: Validator<Registration> = (body) => {
  if (!exactKeys(body, ["id", "reference", "kind", "organisation", "brandName", "state", "version", "tradeLicenceUploaded"], ["brandId", "validFrom", "validTo", "submissionFee", "registeredBrandId", "registeredAuthorisationId", "trail"])) return null;
  const b = body;
  const ok =
    isUuid(b.id) && isString(b.reference) && /^REG-\d{4}-\d+$/.test(b.reference) &&
    (b.kind === "brand" || b.kind === "agency") &&
    isString(b.organisation) && isString(b.brandName) && b.brandName.length >= 1 && b.brandName.length <= 120 &&
    (REGISTRATION_STATES as readonly unknown[]).includes(b.state) &&
    isCount(b.version) && typeof b.tradeLicenceUploaded === "boolean" &&
    (b.brandId === undefined || isUuid(b.brandId)) &&
    (b.validFrom === undefined || isDate(b.validFrom)) &&
    (b.validTo === undefined || isDate(b.validTo)) &&
    (b.submissionFee === undefined || validateSubmissionFee(b.submissionFee) !== null) &&
    (b.registeredBrandId === undefined || (isUuid(b.registeredBrandId) && b.kind === "brand" && b.state === "approved")) &&
    (b.registeredAuthorisationId === undefined || (isUuid(b.registeredAuthorisationId) && b.kind === "agency" && b.state === "approved")) &&
    (b.trail === undefined || (Array.isArray(b.trail) && b.trail.every(validTrailItem))) &&
    // A brand request carries none of the agency fields; an agency request names its brand.
    (b.kind === "agency" ? b.brandId !== undefined : b.brandId === undefined && b.validFrom === undefined && b.validTo === undefined);
  return ok ? (b as unknown as Registration) : null;
};

export const validateRegistrationList: Validator<RegistrationList> = (body) => {
  if (!exactKeys(body, ["items", "count", "authority"])) return null;
  const b = body;
  const ok = b.authority === "spring-database" && Array.isArray(b.items) && b.items.every((i) => validateRegistration(i) !== null) && b.count === b.items.length;
  return ok ? (b as unknown as RegistrationList) : null;
};

export const validateRegistrationBrandList: Validator<RegistrationBrandList> = (body) => {
  if (!exactKeys(body, ["items", "count", "authority"])) return null;
  const b = body;
  const ok =
    b.authority === "spring-database" && Array.isArray(b.items) && b.count === b.items.length &&
    b.items.every((i) => exactKeys(i, ["brandId", "brandName", "principalOrganisation"]) && isUuid((i as Record<string, unknown>).brandId) &&
      isString((i as Record<string, unknown>).brandName) && isString((i as Record<string, unknown>).principalOrganisation));
  return ok ? (b as unknown as RegistrationBrandList) : null;
};

export const validateRegistrationSubmitPreview: Validator<RegistrationSubmitPreview> = (body) => {
  if (!exactKeys(body, ["ready", "version", "intakeNote", "gates"], ["submissionFee"])) return null;
  const b = body;
  const ok =
    typeof b.ready === "boolean" && isCount(b.version) && isString(b.intakeNote) &&
    Array.isArray(b.gates) && b.gates.length >= 2 &&
    b.gates.every((g) => exactKeys(g, ["code", "met"]) && (REGISTRATION_GATE_CODES as readonly unknown[]).includes((g as Record<string, unknown>).code) && typeof (g as Record<string, unknown>).met === "boolean") &&
    (b.submissionFee === undefined || validateSubmissionFee(b.submissionFee) !== null);
  return ok ? (b as unknown as RegistrationSubmitPreview) : null;
};

export const validateRegistrationFeeReceipt: Validator<RegistrationFeeReceipt> = (body) => {
  if (!exactKeys(body, ["registrationId", "reference", "fromState", "toState", "version", "receiptReference", "amountInr", "receivedOn", "confirmedAt"])) return null;
  const b = body;
  const ok =
    isUuid(b.registrationId) && isString(b.reference) && b.fromState === "fee_due" && b.toState === "programme_review" &&
    Number.isInteger(b.version) && (b.version as number) >= 1 && isString(b.receiptReference) && isString(b.amountInr) &&
    isDate(b.receivedOn) && isString(b.confirmedAt) && !Number.isNaN(Date.parse(b.confirmedAt));
  return ok ? (b as unknown as RegistrationFeeReceipt) : null;
};

export const validateRegistrationTransitionReceipt: Validator<RegistrationTransitionReceipt> = (body) => {
  if (!exactKeys(body, ["registrationId", "reference", "action", "fromState", "toState", "version", "actedAt"], ["registeredBrandId", "registeredAuthorisationId"])) return null;
  const b = body;
  const ok =
    isUuid(b.registrationId) && isString(b.reference) && /^REG-\d{4}-\d+$/.test(b.reference) &&
    (REGISTRATION_ACTIONS as readonly unknown[]).includes(b.action) && isState(b.fromState) && isState(b.toState) &&
    Number.isInteger(b.version) && (b.version as number) >= 1 && isString(b.actedAt) && !Number.isNaN(Date.parse(b.actedAt)) &&
    (b.registeredBrandId === undefined || (isUuid(b.registeredBrandId) && b.action === "approve")) &&
    (b.registeredAuthorisationId === undefined || (isUuid(b.registeredAuthorisationId) && b.action === "approve")) &&
    // The moves the workflow allows, per action.
    ((b.action === "recommend" && b.fromState === "programme_review" && b.toState === "director_approval") ||
      (b.action === "return" && (b.fromState === "programme_review" || b.fromState === "director_approval") && b.toState === "returned") ||
      (b.action === "reject" && b.fromState === "director_approval" && b.toState === "rejected") ||
      (b.action === "approve" && b.fromState === "director_approval" && b.toState === "approved") ||
      (b.action === "resubmit" && b.fromState === "returned" && b.toState === "programme_review"));
  return ok ? (b as unknown as RegistrationTransitionReceipt) : null;
};

const validateVersion: Validator<RegistrationDocumentVersion> = (body) => {
  if (!exactKeys(body, ["id", "versionNumber", "contentSha256", "sizeBytes", "mediaType", "originalFilename", "label", "uploadedByAccountId", "uploadedAt", "verificationStatus"])) return null;
  const b = body;
  const ok =
    isUuid(b.id) && Number.isInteger(b.versionNumber) && (b.versionNumber as number) >= 1 &&
    isString(b.contentSha256) && SHA256_HEX.test(b.contentSha256) && Number.isInteger(b.sizeBytes) && (b.sizeBytes as number) >= 1 &&
    b.mediaType === "application/pdf" && isString(b.originalFilename) && isString(b.label) && isUuid(b.uploadedByAccountId) &&
    isString(b.uploadedAt) && !Number.isNaN(Date.parse(b.uploadedAt)) && b.uploadedAt.includes("T") && b.verificationStatus === PENDING;
  return ok ? (b as unknown as RegistrationDocumentVersion) : null;
};

export const validateRegistrationDocument: Validator<RegistrationDocument> = (body) => {
  if (!exactKeys(body, ["id", "documentKind", "verificationStatus", "verificationNote", "versions"], ["latestVersion"])) return null;
  const b = body;
  const ok =
    isUuid(b.id) && b.documentKind === "trade_licence" && b.verificationStatus === PENDING && isString(b.verificationNote) &&
    Array.isArray(b.versions) && b.versions.every((v) => validateVersion(v) !== null) &&
    (b.latestVersion === undefined || validateVersion(b.latestVersion) !== null);
  if (!ok) return null;
  const versions = b.versions as RegistrationDocumentVersion[];
  if (versions.length > 0 && (b.latestVersion as RegistrationDocumentVersion | undefined)?.id !== versions[versions.length - 1].id) return null;
  if (versions.length === 0 && b.latestVersion !== undefined) return null;
  return b as unknown as RegistrationDocument;
};

export const validateRegistrationDocumentList: Validator<RegistrationDocumentList> = (body) => {
  if (!exactKeys(body, ["items", "count", "authority", "verificationNote", "localStore"])) return null;
  const b = body;
  const ok =
    b.authority === "spring-database" && b.localStore === true && isString(b.verificationNote) &&
    Array.isArray(b.items) && b.items.every((i) => validateRegistrationDocument(i) !== null) && b.count === b.items.length;
  return ok ? (b as unknown as RegistrationDocumentList) : null;
};

const WRITE = [...RESOLVER_DENIALS, "no_write_scope"] as const;
const IDEMPOTENCY = ["idempotency_key_conflict", "idempotency_in_progress"] as const;

export const SPRING_REGISTRATION_LIST_ERRORS: UpstreamErrors = { 401: ["unauthenticated"], 403: [...RESOLVER_DENIALS, "no_read_scope"], 503: ["service_unavailable"] };
export const SPRING_REGISTRATION_READ_ERRORS: UpstreamErrors = { ...SPRING_READ_ERRORS, 404: ["not_found"] };
export const SPRING_REGISTRATION_BRANDS_ERRORS: UpstreamErrors = { 401: ["unauthenticated"], 403: WRITE, 503: ["service_unavailable"] };
export const SPRING_REGISTRATION_CREATE_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: WRITE,
  409: [...IDEMPOTENCY, "brand_name_taken", "duplicate_registration"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_REGISTRATION_PATCH_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...WRITE, "not_editable"],
  404: ["not_found"],
  409: ["version_conflict", ...IDEMPOTENCY, "brand_name_taken", "duplicate_registration"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_REGISTRATION_PREVIEW_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...WRITE, "not_submittable"],
  404: ["not_found"],
  503: ["service_unavailable"],
};
export const SPRING_REGISTRATION_SUBMIT_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...WRITE, "brand_not_permitted", "not_submittable"],
  404: ["not_found"],
  409: ["version_conflict", ...IDEMPOTENCY, "fee_preview_conflict", "brand_name_taken"],
  422: ["validation_failed", "idempotency_key_required", "rule_not_available", "document_required"],
  503: ["service_unavailable"],
};
export const SPRING_REGISTRATION_FEE_ERRORS: UpstreamErrors = {
  ...SPRING_FEE_CONFIRMATION_ERRORS,
  409: ["version_conflict", ...IDEMPOTENCY],
};
export const SPRING_REGISTRATION_TRANSITION_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "role_not_permitted", "segregation_refused", "brand_not_permitted"],
  404: ["not_found"],
  409: ["version_conflict", ...IDEMPOTENCY, "brand_name_taken", "authorisation_overlap"],
  422: ["validation_failed", "idempotency_key_required", "document_required"],
  503: ["service_unavailable"],
};
export const SPRING_REGISTRATION_DOC_UPLOAD_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...WRITE, "not_editable"],
  404: ["not_found"],
  409: [...IDEMPOTENCY],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_REGISTRATION_LIST = { errors: SPRING_REGISTRATION_LIST_ERRORS, validate: validateRegistrationList };
export const SPRING_REGISTRATION_READ = { errors: SPRING_REGISTRATION_READ_ERRORS, validate: validateRegistration };
export const SPRING_REGISTRATION_BRANDS = { errors: SPRING_REGISTRATION_BRANDS_ERRORS, validate: validateRegistrationBrandList };
export const SPRING_REGISTRATION_CREATE = { errors: SPRING_REGISTRATION_CREATE_ERRORS, validate: validateRegistration, successStatuses: [201] as const };
export const SPRING_REGISTRATION_PATCH = { errors: SPRING_REGISTRATION_PATCH_ERRORS, validate: validateRegistration, successStatuses: [200] as const };
export const SPRING_REGISTRATION_PREVIEW = { errors: SPRING_REGISTRATION_PREVIEW_ERRORS, validate: validateRegistrationSubmitPreview };
export const SPRING_REGISTRATION_SUBMIT = { errors: SPRING_REGISTRATION_SUBMIT_ERRORS, validate: validateRegistration, successStatuses: [200] as const };
export const SPRING_REGISTRATION_FEE = { errors: SPRING_REGISTRATION_FEE_ERRORS, validate: validateRegistrationFeeReceipt, successStatuses: [200] as const };
export const SPRING_REGISTRATION_TRANSITION = { errors: SPRING_REGISTRATION_TRANSITION_ERRORS, validate: validateRegistrationTransitionReceipt, successStatuses: [200] as const };
export const SPRING_REGISTRATION_DOC_LIST = { errors: SPRING_REGISTRATION_READ_ERRORS, validate: validateRegistrationDocumentList };
export const SPRING_REGISTRATION_DOC_UPLOAD = { errors: SPRING_REGISTRATION_DOC_UPLOAD_ERRORS, validate: validateRegistrationDocument, successStatuses: [201] as const };
/** No JSON success: fromUpstream maps only the documented JSON errors; sessionReadBinary handles the 200 PDF. */
export const SPRING_REGISTRATION_DOC_CONTENT = { errors: SPRING_REGISTRATION_READ_ERRORS, validate: (() => null) as Validator<never>, successStatuses: [] as readonly number[] };
