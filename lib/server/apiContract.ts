/**
 * The BEE local API contract at the Next.js boundary (WP03.1,
 * docs/wp03/bee-local-api.openapi.json). Pure: no framework imports, so
 * `node --test scripts/local/api-contract.test.mjs` can exercise it.
 */
import { randomUUID } from "node:crypto";

export const CONTRACT_VERSION = "0.23.0";
export const CORRELATION_HEADER = "X-Correlation-Id";

/** Same rule as Spring's CorrelationIdFilter. */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9-]{1,64}$/;

export const acceptCorrelationId = (value: string | null | undefined): string | null =>
  value && SAFE_CORRELATION_ID.test(value) ? value : null;

/** A caller's safe ID is kept; anything else is replaced. Never an authorization input. */
export const correlationIdFrom = (value: string | null | undefined): string => acceptCorrelationId(value) ?? randomUUID();

/** Every error code either layer may return, with its fixed client-safe message. */
export const ERROR_MESSAGES = {
  // Spring (also passed through by the Next boundary)
  unauthenticated: "A valid access token is required.",
  denied_by_default: "This operation is not available.",
  mfa_required: "Sign-in must include a verified one-time code.",
  no_active_account: "There is no active BEE account for this identity.",
  no_effective_role: "There is no active BEE role for this identity.",
  no_read_scope: "This role has no read access to model applications.",
  no_write_scope: "This role cannot create or edit model application drafts.",
  brand_not_permitted: "This brand is not available to your organisation.",
  not_editable: "Only draft applications can be edited.",
  not_submittable: "Only draft applications can be submitted.",
  rule_not_available: "Required category, standard or fee rules are not available.",
  validation_failed: "The request could not be accepted.",
  role_not_permitted: "This role cannot perform this action.",
  segregation_refused: "A person who acted at another stage of this application, or its own organisation, cannot take this step.",
  amount_mismatch: "The amount received does not match the fee due.",
  assignee_unavailable: "No officer is available to take the next stage.",
  not_returned: "Only a returned application can be resubmitted.",
  rating_below_threshold: "The verified efficiency is below the lowest star band, so no rating can be assigned.",
  correction_already_pending: "A correction for this receipt is already waiting for a decision.",
  proposal_not_pending: "This proposal has already been decided or withdrawn.",
  effective_date_passed: "The date this rule was to start has passed; propose it again with a later date.",
  rule_conflict: "This rule cannot start on that date because of the rules already in place.",
  test_report_required: "A test report must be uploaded before the application can be submitted.",
  declared_efficiency_required: "The declared efficiency figure is required before the application can be submitted.",
  test_date_invalid: "A test date that is not in the future is required before the application can be submitted.",
  laboratory_not_accredited: "The laboratory must hold an active accreditation for this category on the test date.",
  standard_not_available: "No applicable standard is in force on the test date.",
  duplicate_model: "Another application already holds this brand and model number.",
  version_conflict: "The record has changed since it was loaded.",
  fee_preview_conflict: "The provisional fee changed since it was reviewed.",
  idempotency_key_required: "An Idempotency-Key header is required for this request.",
  idempotency_key_conflict: "This Idempotency-Key was already used with a different request body.",
  idempotency_in_progress: "A request with this Idempotency-Key is still in progress.",
  not_found: "No such record is available to you.",
  service_unavailable: "The service is temporarily unavailable. Try again later.",
  internal_error: "The request could not be completed.",
  // Next.js boundary only
  no_session: "Sign in to continue.",
  session_expired: "Your session has ended. Sign in again.",
  identity_unavailable: "The identity service is not reachable. Try again later.",
  api_unreachable: "The BEE service is not reachable. Try again later.",
  invalid_api_response: "The BEE service returned an unexpected response.",
  api_error: "The BEE service could not complete the request.",
  cross_origin: "This request must come from the BEE portal.",
  method_not_allowed: "This method is not supported for this resource.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ErrorBody {
  error: ErrorCode;
  message: string;
}

export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);

export const errorBody = (code: ErrorCode): ErrorBody => ({ error: code, message: ERROR_MESSAGES[code] });

/** Status and code pairs a Spring operation may return (its contract x-error-codes, minus 500). */
export type UpstreamErrors = Readonly<Record<number, readonly ErrorCode[]>>;

export const RESOLVER_DENIALS = ["mfa_required", "no_active_account", "no_effective_role"] as const;

export const SPRING_ME_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: RESOLVER_DENIALS,
  503: ["service_unavailable"],
};

/** A body that passed validation, or null. Validators must reject unknown fields. */
export type Validator<T> = (body: unknown) => T | null;

export interface Me {
  subject: string;
  username: string;
  displayName: string;
  authority: "spring-database";
  effectiveRoles: { role: string; scope: string }[];
  /** The permissions the effective roles hold. The menu uses it to offer a screen; Spring still decides every action. */
  capabilities: string[];
  organisations: { code: string; kind: string; name: string }[];
  activeAssignments: number;
  tokenRoles: string[];
  authMethods: string[];
  ignoredTokenClaims?: { organisation: string };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isString = (v: unknown): v is string => typeof v === "string";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exactly these keys: every required one present, nothing else. */
export function exactKeys(v: unknown, required: readonly string[], optional: readonly string[] = []): v is Record<string, unknown> {
  if (!isObject(v)) return false;
  const keys = Object.keys(v);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}
const arrayOf = (v: unknown, item: (x: unknown) => boolean, minItems = 0) => Array.isArray(v) && v.length >= minItems && v.every(item);
const record = (keys: readonly string[]) => (x: unknown) => exactKeys(x, keys) && keys.every((k) => isString(x[k]));

export const ME_REQUIRED = ["subject", "username", "displayName", "authority", "effectiveRoles", "capabilities", "organisations", "activeAssignments", "tokenRoles", "authMethods"] as const;
export const ME_OPTIONAL = ["ignoredTokenClaims"] as const;

/** The contract's Me schema, strictly: a field the contract does not document is a fault. */
export const validateMe: Validator<Me> = (body) => {
  if (!exactKeys(body, ME_REQUIRED, ME_OPTIONAL)) return null;
  const b = body;
  const ok =
    isString(b.subject) && UUID.test(b.subject) &&
    isString(b.username) && isString(b.displayName) &&
    b.authority === "spring-database" &&
    arrayOf(b.effectiveRoles, record(["role", "scope"]), 1) &&
    arrayOf(b.capabilities, isString) &&
    arrayOf(b.organisations, record(["code", "kind", "name"])) &&
    Number.isInteger(b.activeAssignments) && (b.activeAssignments as number) >= 0 &&
    arrayOf(b.tokenRoles, isString) &&
    arrayOf(b.authMethods, isString) &&
    (b.ignoredTokenClaims === undefined || record(["organisation"])(b.ignoredTokenClaims));
  return ok ? (b as unknown as Me) : null;
};

/**
 * Maps a Spring answer to the browser-facing answer. A success passes only if it matches
 * the operation's schema; a denial passes only if its status and code are documented for
 * the operation, and then with the contract message. Anything else (unexpected fields,
 * unknown code, 500, unparseable body) becomes a fixed 502, so Spring's text never
 * reaches the browser.
 */
export type UpstreamOp<T> = { errors: UpstreamErrors; validate: Validator<T>; successStatuses?: readonly number[] };

export function fromUpstream<T>(status: number, body: unknown, op: UpstreamOp<T>):
  { ok: true; status: number; body: T } | { ok: false; status: number; body: ErrorBody } {
  const code = (body as { error?: unknown } | null)?.error;
  if (code === "api_unreachable") return { ok: false, status: 503, body: errorBody("api_unreachable") };
  if (code === "invalid_api_response") return { ok: false, status: 502, body: errorBody("invalid_api_response") };
  const success = op.successStatuses ?? [200];
  if (success.includes(status)) {
    const valid = op.validate(body);
    return valid ? { ok: true, status, body: valid } : { ok: false, status: 502, body: errorBody("invalid_api_response") };
  }
  if (isErrorCode(code) && op.errors[status]?.includes(code)) return { ok: false, status, body: errorBody(code) };
  return { ok: false, status: 502, body: errorBody("api_error") };
}

export const SPRING_ME = { errors: SPRING_ME_ERRORS, validate: validateMe };

export const SPRING_LIST_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "no_read_scope"],
  503: ["service_unavailable"],
};

/** Not found is one answer for out-of-scope, unknown, malformed and stale-assignment IDs. */
export const SPRING_READ_ERRORS: UpstreamErrors = { ...SPRING_LIST_ERRORS, 404: ["not_found"] };

export const MODEL_STATES = ["draft", "fee_due", "iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval", "approved", "returned", "rejected"] as const;
export type ModelState = (typeof MODEL_STATES)[number];

export interface ModelApplication {
  id: string;
  reference: string;
  organisation: string;
  brandName: string;
  category: string;
  modelNumber: string;
  state: ModelState;
  version: number;
  readBasis: string[];
  brandId?: string;
  principalOrganisation?: string;
  laboratoryCode?: string;
  testedOn?: string;
  declaredIseer?: number;
  submissionFee?: SubmissionFee;
  rating?: ApplicationRating;
  returnNote?: ApplicationReturn;
  rejection?: ApplicationRejection;
  certificate?: ApplicationCertificate;
}

export interface ModelApplicationList {
  items: ModelApplication[];
  count: number;
  authority: "spring-database";
}

export interface SubmissionFee {
  /** The fee before tax. */
  amountInr: string;
  /** The separate tax line: the rate in percent, the tax, and the whole fee due (fee plus tax). */
  taxRatePercent: string;
  taxInr: string;
  totalInr: string;
  currency: string;
  feeRuleKey: string;
  feeRuleVersion: number;
  verificationStatus: string;
  localDemoFee: boolean;
  label: string;
  sourceReference?: string;
}

const SUBMISSION_FEE_KEYS = ["amountInr", "taxRatePercent", "taxInr", "totalInr", "currency", "feeRuleKey", "feeRuleVersion", "verificationStatus", "localDemoFee", "label"] as const;
const SUBMISSION_FEE_OPTIONAL = ["sourceReference"] as const;

export const validateSubmissionFee: Validator<SubmissionFee> = (body) => {
  if (!exactKeys(body, SUBMISSION_FEE_KEYS, SUBMISSION_FEE_OPTIONAL)) return null;
  const b = body;
  const ok =
    isString(b.amountInr) && isString(b.taxRatePercent) && /^\d{1,3}\.\d{2}$/.test(b.taxRatePercent) && isString(b.taxInr) && /^\d+\.\d{2}$/.test(b.taxInr) &&
    isString(b.totalInr) && /^\d+\.\d{2}$/.test(b.totalInr) && isString(b.currency) && b.currency === "INR" &&
    isString(b.feeRuleKey) && Number.isInteger(b.feeRuleVersion) && (b.feeRuleVersion as number) >= 1 &&
    isString(b.verificationStatus) && typeof b.localDemoFee === "boolean" && isString(b.label) &&
    (b.sourceReference === undefined || isString(b.sourceReference));
  return ok ? (b as unknown as SubmissionFee) : null;
};

/** The latest rating record, on the detail read only. PROVISIONAL LOCAL DEMONSTRATION: never a BEE rating. */
export interface ApplicationRating {
  ratingVersion: number;
  schemeKey: string;
  declaredIseer: string;
  verifiedIseer: string;
  stars: number;
  localDemoRating: true;
  computedAt: string;
}

export const validateApplicationRating: Validator<ApplicationRating> = (body) => {
  if (!exactKeys(body, ["ratingVersion", "schemeKey", "declaredIseer", "verifiedIseer", "stars", "localDemoRating", "computedAt"])) return null;
  const b = body;
  const ok =
    Number.isInteger(b.ratingVersion) && (b.ratingVersion as number) >= 1 &&
    isString(b.schemeKey) && isString(b.declaredIseer) && isString(b.verifiedIseer) &&
    Number.isInteger(b.stars) && (b.stars as number) >= 1 && (b.stars as number) <= 5 &&
    b.localDemoRating === true && isString(b.computedAt) && !Number.isNaN(Date.parse(b.computedAt));
  return ok ? (b as unknown as ApplicationRating) : null;
};

/** The open return of an application in the returned state, on the detail read only. */
export interface ApplicationReturn {
  fromState: "iame_scrutiny" | "bee_scrutiny" | "director_review" | "secretary_approval";
  reason: string;
  returnedAt: string;
}

export const validateApplicationReturn: Validator<ApplicationReturn> = (body) => {
  if (!exactKeys(body, ["fromState", "reason", "returnedAt"])) return null;
  const b = body;
  const ok =
    ["iame_scrutiny", "bee_scrutiny", "director_review", "secretary_approval"].includes(b.fromState as string) &&
    isString(b.reason) && isString(b.returnedAt) && !Number.isNaN(Date.parse(b.returnedAt));
  return ok ? (b as unknown as ApplicationReturn) : null;
};

/** The rejection of an application in the rejected state (terminal), on the detail read only. */
export interface ApplicationRejection {
  fromState: "iame_scrutiny" | "bee_scrutiny" | "rating" | "director_review" | "secretary_approval";
  reason: string;
  rejectedAt: string;
}

export const validateApplicationRejection: Validator<ApplicationRejection> = (body) => {
  if (!exactKeys(body, ["fromState", "reason", "rejectedAt"])) return null;
  const b = body;
  const ok =
    ["iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval"].includes(b.fromState as string) &&
    isString(b.reason) && isString(b.rejectedAt) && !Number.isNaN(Date.parse(b.rejectedAt));
  return ok ? (b as unknown as ApplicationRejection) : null;
};

/** The certificate issued at approval, on the detail read only (a local demonstration, never a BEE certificate). */
export interface ApplicationCertificate {
  registrationId: string;
  validFrom: string;
  validTo: string;
  status: "valid" | "expired" | "not_yet_valid";
  stars: number;
  declaredIseer: string;
  verifiedIseer: string;
  schemeKey: string;
  localDemoCertificate: true;
  issuedAt: string;
}

export const validateApplicationCertificate: Validator<ApplicationCertificate> = (body) => {
  if (!exactKeys(body, ["registrationId", "validFrom", "validTo", "status", "stars", "declaredIseer", "verifiedIseer", "schemeKey", "localDemoCertificate", "issuedAt"])) return null;
  const b = body;
  const ok =
    isString(b.registrationId) && /^BEE\/[A-Z]{2,10}\/[0-9]{4}\/[0-9]{5,}$/.test(b.registrationId) &&
    isString(b.validFrom) && ISO_DATE.test(b.validFrom) && isString(b.validTo) && ISO_DATE.test(b.validTo) && b.validTo > b.validFrom &&
    (b.status === "valid" || b.status === "expired" || b.status === "not_yet_valid") &&
    Number.isInteger(b.stars) && (b.stars as number) >= 1 && (b.stars as number) <= 5 &&
    isString(b.declaredIseer) && isString(b.verifiedIseer) && isString(b.schemeKey) && b.localDemoCertificate === true &&
    isString(b.issuedAt) && !Number.isNaN(Date.parse(b.issuedAt));
  return ok ? (b as unknown as ApplicationCertificate) : null;
};

export const MODEL_APPLICATION_KEYS = ["id", "reference", "organisation", "brandName", "category", "modelNumber", "state", "version", "readBasis"] as const;
export const MODEL_APPLICATION_OPTIONAL = ["brandId", "principalOrganisation", "laboratoryCode", "testedOn", "declaredIseer", "submissionFee", "rating", "returnNote", "rejection", "certificate"] as const;
export const MODEL_APPLICATION_LIST_KEYS = ["items", "count", "authority"] as const;
const READ_BASIS = /^(own-org|assigned|stage:[a-z_]+)$/;
const LABORATORY_CODE = /^[A-Z0-9_-]{1,32}$/;

export const validateModelApplication: Validator<ModelApplication> = (body) => {
  if (!exactKeys(body, MODEL_APPLICATION_KEYS, MODEL_APPLICATION_OPTIONAL)) return null;
  const b = body;
  const ok =
    isString(b.id) && UUID.test(b.id) &&
    ["reference", "organisation", "brandName", "category", "modelNumber"].every((k) => isString(b[k])) &&
    (MODEL_STATES as readonly unknown[]).includes(b.state) &&
    Number.isInteger(b.version) && (b.version as number) >= 0 &&
    arrayOf(b.readBasis, (x) => isString(x) && READ_BASIS.test(x), 1) &&
    (b.brandId === undefined || (isString(b.brandId) && UUID.test(b.brandId))) &&
    (b.principalOrganisation === undefined || isString(b.principalOrganisation)) &&
    (b.laboratoryCode === undefined || (isString(b.laboratoryCode) && LABORATORY_CODE.test(b.laboratoryCode))) &&
    (b.testedOn === undefined || (isString(b.testedOn) && ISO_DATE.test(b.testedOn))) &&
    (b.declaredIseer === undefined || (typeof b.declaredIseer === "number" && b.declaredIseer > 0 && b.declaredIseer <= 99.99)) &&
    (b.submissionFee === undefined || validateSubmissionFee(b.submissionFee) !== null) &&
    (b.rating === undefined || validateApplicationRating(b.rating) !== null) &&
    (b.returnNote === undefined || validateApplicationReturn(b.returnNote) !== null) &&
    (b.rejection === undefined || validateApplicationRejection(b.rejection) !== null) &&
    (b.certificate === undefined || validateApplicationCertificate(b.certificate) !== null);
  return ok ? (b as unknown as ModelApplication) : null;
};

export interface EligibleBrand {
  brandId: string;
  brandName: string;
  principalOrganisation: string;
  principalOrganisationId: string;
}

export interface EligibleLaboratory {
  code: string;
  name: string;
}

export interface EligibleBrandList {
  items: EligibleBrand[];
  count: number;
  authority: "spring-database";
  laboratories: EligibleLaboratory[];
}

export const validateEligibleBrandList: Validator<EligibleBrandList> = (body) => {
  if (!exactKeys(body, ["items", "count", "authority", "laboratories"])) return null;
  const b = body;
  if (b.authority !== "spring-database" || !Array.isArray(b.items) || b.count !== b.items.length) return null;
  const labOk = (x: unknown) => {
    if (!exactKeys(x, ["code", "name"])) return false;
    const row = x as Record<string, unknown>;
    return isString(row.code) && LABORATORY_CODE.test(row.code) && isString(row.name);
  };
  if (!Array.isArray(b.laboratories) || !b.laboratories.every(labOk)) return null;
  const itemOk = (x: unknown) => {
    if (!exactKeys(x, ["brandId", "brandName", "principalOrganisation", "principalOrganisationId"])) return false;
    const row = x as Record<string, unknown>;
    return isString(row.brandId) && UUID.test(row.brandId) && isString(row.brandName) &&
      isString(row.principalOrganisation) && isString(row.principalOrganisationId) && UUID.test(row.principalOrganisationId);
  };
  return b.items.every(itemOk) ? (b as unknown as EligibleBrandList) : null;
};

const WRITE_DENIALS = [...RESOLVER_DENIALS, "no_write_scope", "brand_not_permitted", "not_editable", "not_submittable"] as const;

export const SPRING_ELIGIBLE_BRANDS_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: WRITE_DENIALS,
  503: ["service_unavailable"],
};

export const SPRING_CREATE_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: WRITE_DENIALS,
  409: ["idempotency_key_conflict", "idempotency_in_progress"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_PATCH_ERRORS: UpstreamErrors = {
  ...SPRING_CREATE_ERRORS,
  403: [...WRITE_DENIALS],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress"],
};

export const SPRING_ELIGIBLE_BRANDS = { errors: SPRING_ELIGIBLE_BRANDS_ERRORS, validate: validateEligibleBrandList };
export const SPRING_CREATE = { errors: SPRING_CREATE_ERRORS, validate: validateModelApplication, successStatuses: [201] as const };
export const SPRING_PATCH = { errors: SPRING_PATCH_ERRORS, validate: validateModelApplication, successStatuses: [200] as const };

export interface DraftSummary {
  brandName: string;
  category: string;
  modelNumber: string;
}

export const EVIDENCE_GATE_CODES = ["test_report_required", "declared_efficiency_required", "test_date_invalid", "laboratory_not_accredited", "standard_not_available", "duplicate_model"] as const;
export type EvidenceGateCode = (typeof EVIDENCE_GATE_CODES)[number];

export interface EvidenceGate {
  code: EvidenceGateCode;
  met: boolean;
}

export interface SubmitPreview {
  ready: boolean;
  version: number;
  intakeNote: string;
  evidenceGates: EvidenceGate[];
  submissionFee?: SubmissionFee;
  draftSummary?: DraftSummary;
}

export interface ExpectedFeeSubmit {
  amountInr: string;
  feeRuleKey: string;
  feeRuleVersion: number;
}

export interface ModelApplicationSubmitted extends ModelApplication {
  submissionFee: SubmissionFee;
}

const validateDraftSummary: Validator<DraftSummary> = (body) => {
  if (!exactKeys(body, ["brandName", "category", "modelNumber"])) return null;
  const b = body;
  const ok = ["brandName", "category", "modelNumber"].every((k) => isString(b[k]));
  return ok ? (b as unknown as DraftSummary) : null;
};

export const validateSubmitPreview: Validator<SubmitPreview> = (body) => {
  if (!exactKeys(body, ["ready", "version", "intakeNote", "evidenceGates"], ["submissionFee", "draftSummary"])) return null;
  const b = body;
  const gatesOk =
    Array.isArray(b.evidenceGates) && b.evidenceGates.length === EVIDENCE_GATE_CODES.length &&
    b.evidenceGates.every((g, i) => exactKeys(g, ["code", "met"]) && (g as Record<string, unknown>).code === EVIDENCE_GATE_CODES[i] && typeof (g as Record<string, unknown>).met === "boolean");
  const ok =
    typeof b.ready === "boolean" && Number.isInteger(b.version) && (b.version as number) >= 0 &&
    isString(b.intakeNote) && gatesOk &&
    (b.submissionFee === undefined || validateSubmissionFee(b.submissionFee) !== null) &&
    (b.draftSummary === undefined || validateDraftSummary(b.draftSummary) !== null);
  return ok ? (b as unknown as SubmitPreview) : null;
};

export const validateModelApplicationSubmitted: Validator<ModelApplicationSubmitted> = (body) => {
  if (!isObject(body)) return null;
  const keys = Object.keys(body);
  const allowed = [...MODEL_APPLICATION_KEYS, ...MODEL_APPLICATION_OPTIONAL, "submissionFee"];
  if (!keys.every((k) => (allowed as readonly string[]).includes(k))) return null;
  const { submissionFee, ...appFields } = body;
  if (validateModelApplication(appFields) === null || validateSubmissionFee(submissionFee) === null) return null;
  return body as unknown as ModelApplicationSubmitted;
};

export const SPRING_SUBMIT_PREVIEW_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "no_write_scope", "not_submittable"],
  404: ["not_found"],
  503: ["service_unavailable"],
};

export const SPRING_SUBMIT_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "no_write_scope", "brand_not_permitted", "not_submittable"],
  404: ["not_found"],
  409: ["version_conflict", "idempotency_key_conflict", "idempotency_in_progress", "fee_preview_conflict", "duplicate_model"],
  422: ["validation_failed", "idempotency_key_required", "rule_not_available", "test_report_required", "declared_efficiency_required", "test_date_invalid", "laboratory_not_accredited", "standard_not_available"],
  503: ["service_unavailable"],
};

export const SPRING_SUBMIT_PREVIEW = { errors: SPRING_SUBMIT_PREVIEW_ERRORS, validate: validateSubmitPreview };
export const SPRING_SUBMIT = { errors: SPRING_SUBMIT_ERRORS, validate: validateModelApplicationSubmitted, successStatuses: [200] as const };

/** Every item is a valid ModelApplication and count is the item count. */
export const validateModelApplicationList: Validator<ModelApplicationList> = (body) => {
  if (!exactKeys(body, MODEL_APPLICATION_LIST_KEYS)) return null;
  const b = body;
  const ok =
    b.authority === "spring-database" &&
    Array.isArray(b.items) && b.items.every((i) => validateModelApplication(i) !== null) &&
    b.count === b.items.length;
  return ok ? (b as unknown as ModelApplicationList) : null;
};

export const SPRING_LIST = { errors: SPRING_LIST_ERRORS, validate: validateModelApplicationList };
export const SPRING_READ = { errors: SPRING_READ_ERRORS, validate: validateModelApplication };

/* ---------- WP06.1a: local test-report document intake ---------- */

export interface DocumentVersion {
  id: string;
  versionNumber: number;
  contentSha256: string;
  sizeBytes: number;
  mediaType: "application/pdf";
  originalFilename: string;
  reportLabel: string;
  testedOn?: string;
  laboratoryName?: string;
  uploadedByAccountId: string;
  uploadedAt: string;
  verificationStatus: "pending_local_verification";
}

export interface ModelDocument {
  id: string;
  documentKind: "test_report";
  verificationStatus: "pending_local_verification";
  verificationNote: string;
  versions: DocumentVersion[];
  latestVersion?: DocumentVersion;
}

export interface DocumentList {
  items: ModelDocument[];
  count: number;
  authority: "spring-database";
  verificationNote: string;
  localStore: true;
}

const DOCUMENT_VERSION_KEYS = ["id", "versionNumber", "contentSha256", "sizeBytes", "mediaType", "originalFilename", "reportLabel", "uploadedByAccountId", "uploadedAt", "verificationStatus"] as const;
const DOCUMENT_VERSION_OPTIONAL = ["testedOn", "laboratoryName"] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PENDING = "pending_local_verification";

export const validateDocumentVersion: Validator<DocumentVersion> = (body) => {
  if (!exactKeys(body, DOCUMENT_VERSION_KEYS, DOCUMENT_VERSION_OPTIONAL)) return null;
  const b = body;
  const ok =
    isString(b.id) && UUID.test(b.id) &&
    Number.isInteger(b.versionNumber) && (b.versionNumber as number) >= 1 &&
    isString(b.contentSha256) && SHA256_HEX.test(b.contentSha256) &&
    Number.isInteger(b.sizeBytes) && (b.sizeBytes as number) >= 1 &&
    b.mediaType === "application/pdf" &&
    isString(b.originalFilename) && isString(b.reportLabel) &&
    (b.testedOn === undefined || (isString(b.testedOn) && ISO_DATE.test(b.testedOn))) &&
    (b.laboratoryName === undefined || isString(b.laboratoryName)) &&
    isString(b.uploadedByAccountId) && UUID.test(b.uploadedByAccountId) &&
    isString(b.uploadedAt) && !Number.isNaN(Date.parse(b.uploadedAt)) && b.uploadedAt.includes("T") &&
    b.verificationStatus === PENDING;
  return ok ? (b as unknown as DocumentVersion) : null;
};

export const validateDocument: Validator<ModelDocument> = (body) => {
  if (!exactKeys(body, ["id", "documentKind", "verificationStatus", "verificationNote", "versions"], ["latestVersion"])) return null;
  const b = body;
  const ok =
    isString(b.id) && UUID.test(b.id) &&
    b.documentKind === "test_report" &&
    b.verificationStatus === PENDING &&
    isString(b.verificationNote) &&
    Array.isArray(b.versions) && b.versions.every((v) => validateDocumentVersion(v) !== null) &&
    (b.latestVersion === undefined || validateDocumentVersion(b.latestVersion) !== null);
  if (!ok) return null;
  /* a document with versions names its newest one */
  const versions = b.versions as DocumentVersion[];
  if (versions.length > 0 && (b.latestVersion as DocumentVersion | undefined)?.id !== versions[versions.length - 1].id) return null;
  if (versions.length === 0 && b.latestVersion !== undefined) return null;
  return b as unknown as ModelDocument;
};

export const validateDocumentList: Validator<DocumentList> = (body) => {
  if (!exactKeys(body, ["items", "count", "authority", "verificationNote", "localStore"])) return null;
  const b = body;
  const ok =
    b.authority === "spring-database" && b.localStore === true && isString(b.verificationNote) &&
    Array.isArray(b.items) && b.items.every((i) => validateDocument(i) !== null) &&
    b.count === b.items.length;
  return ok ? (b as unknown as DocumentList) : null;
};

export const SPRING_DOC_LIST_ERRORS: UpstreamErrors = SPRING_READ_ERRORS;

export const SPRING_DOC_UPLOAD_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "no_write_scope", "brand_not_permitted", "not_editable"],
  404: ["not_found"],
  409: ["idempotency_key_conflict", "idempotency_in_progress"],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

/** Same denials as the list; a 200 is binary and never goes through the JSON validator. */
export const SPRING_DOC_CONTENT_ERRORS: UpstreamErrors = SPRING_READ_ERRORS;

export const SPRING_DOC_LIST = { errors: SPRING_DOC_LIST_ERRORS, validate: validateDocumentList };
export const SPRING_DOC_UPLOAD = { errors: SPRING_DOC_UPLOAD_ERRORS, validate: validateDocument, successStatuses: [201] as const };
/** No JSON success: fromUpstream maps only the documented JSON errors; sessionReadBinary handles the 200 PDF. */
export const SPRING_DOC_CONTENT = { errors: SPRING_DOC_CONTENT_ERRORS, validate: (() => null) as Validator<never>, successStatuses: [] as readonly number[] };

/**
 * The detail ID as one Spring path segment. The ID is not checked for UUID shape here, so
 * Next never answers "no such record" itself; Spring decides scope first and then 404s.
 * A value that cannot travel safely as one segment is replaced by a fixed non-UUID, which
 * Spring answers exactly like any other malformed ID.
 */
export const springIdSegment = (id: string): string => (/^[A-Za-z0-9._~-]{1,128}$/.test(id) && id !== "." && id !== ".." ? id : "-");

/** Every code the sign-in callback may put in /login?error=. Anything else is replaced. */
export const LOGIN_REDIRECT_CODES = [
  "login_expired", "access_denied", "identity_error", "invalid_state", "invalid_issuer", "invalid_callback",
  "code_exchange_failed", "invalid_id_token", "mfa_required", "subject_mismatch",
  "unauthenticated", "no_active_account", "no_effective_role", "service_unavailable",
  "api_unreachable", "invalid_api_response", "api_error",
] as const;
export type LoginRedirectCode = (typeof LOGIN_REDIRECT_CODES)[number];

export const safeLoginCode = (code: unknown): LoginRedirectCode =>
  (LOGIN_REDIRECT_CODES as readonly unknown[]).includes(code) ? (code as LoginRedirectCode) : "api_error";

/** Decides the callback from Spring's /api/me answer: a session only for a valid Me of the same subject. */
export function callbackOutcome(status: number, body: unknown, subject: string): { ok: true; me: Me } | { ok: false; code: LoginRedirectCode } {
  const out = fromUpstream(status, body, SPRING_ME);
  if (!out.ok) return { ok: false, code: safeLoginCode(out.body.error) };
  return out.body.subject === subject ? { ok: true, me: out.body } : { ok: false, code: "subject_mismatch" };
}
