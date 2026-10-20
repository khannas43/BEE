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
  "returned",
  "active_observation",
  "active",
  "on_hold",
  "rejected",
  "revoked",
] as const;

export const MANUFACTURER_ONBOARDING_DOCUMENT_KINDS = [
  "trade_licence",
  "certificate_of_incorporation",
  "gst_certificate",
  "pan_card",
  "signatory_photo_id",
  "facility_address_proof",
  "signed_declaration",
  "signed_agreement",
  "annexure_supporting",
  "retailers_list",
  "trademark_company_registration",
  "qms_iso9001",
  "signatory_authority_letter",
  "signatory_id_proof",
  "ssi_certificate",
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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const SUMMARY_REQUIRED = ["id", "reference", "organisationId", "legalName", "state", "version", "tradeLicenceUploaded", "createdAt"] as const;
const SUMMARY_OPTIONAL = ["permitteeNumber", "observationEndsOn"] as const;

const DETAIL_OPTIONAL = [
  ...SUMMARY_OPTIONAL,
  "draft",
  "documents",
  "automatedChecks",
  "lifecycle",
  "anomalies",
  "outcome",
  "paymentId",
  "fee",
  "payment",
  "directorDecision",
  "permitteeActivation",
  "observation",
] as const;

/** Field values only — no exact-key check (shared by summary and detail). */
export function validateManufacturerOnboardingItemFields(body: unknown): boolean {
  if (!isObject(body)) return false;
  const b = body;
  return (
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
    (b.observationEndsOn === undefined || (isString(b.observationEndsOn) && DATE.test(b.observationEndsOn)))
  );
}

const validateDocumentHead = (d: unknown): boolean => {
  if (!isObject(d) || !exactKeys(d, ["documentKind", "latestVersion", "status"], ["expiresOn"])) return false;
  return (
    (MANUFACTURER_ONBOARDING_DOCUMENT_KINDS as readonly string[]).includes(d.documentKind as string) &&
    isCount(d.latestVersion) &&
    isString(d.status) &&
    ["missing", "uploaded", "expired"].includes(d.status as string) &&
    (d.expiresOn === undefined || (isString(d.expiresOn) && DATE.test(d.expiresOn)))
  );
};

const validateAutomatedCheck = (c: unknown): boolean => {
  if (!isObject(c) || !exactKeys(c, ["checkCode", "outcome", "checkedAt"], ["detail"])) return false;
  return (
    isString(c.checkCode) &&
    (c.outcome === "pass" || c.outcome === "fail") &&
    isString(c.checkedAt) &&
    !Number.isNaN(Date.parse(c.checkedAt)) &&
    (c.detail === undefined || c.detail === null || isString(c.detail))
  );
};

const validateLifecycleEvent = (e: unknown): boolean => {
  if (!isObject(e) || !exactKeys(e, ["eventKind", "fromState", "toState", "actorRole", "occurredAt"], ["detail"])) return false;
  return (
    isString(e.eventKind) &&
    (e.fromState === null || e.fromState === undefined || isState(e.fromState)) &&
    (e.toState === null || e.toState === undefined || isState(e.toState)) &&
    isString(e.actorRole) &&
    isString(e.occurredAt) &&
    !Number.isNaN(Date.parse(e.occurredAt)) &&
    (e.detail === undefined || e.detail === null || isString(e.detail))
  );
};

const validateAnomaly = (a: unknown): boolean => {
  if (!isObject(a) || !exactKeys(a, ["raisedByRole", "reason", "raisedAt"], ["resolution", "resolvedAt"])) return false;
  return (
    (a.raisedByRole === "finance" || a.raisedByRole === "programme" || a.raisedByRole === "director") &&
    isString(a.reason) &&
    isString(a.raisedAt) &&
    !Number.isNaN(Date.parse(a.raisedAt)) &&
    (a.resolution === undefined || a.resolution === null || a.resolution === "cleared" || a.resolution === "revoked") &&
    (a.resolvedAt === undefined || (isString(a.resolvedAt) && !Number.isNaN(Date.parse(a.resolvedAt))))
  );
};

const validateFeeBlock = (fee: unknown): boolean => {
  if (!isObject(fee) || !exactKeys(fee, ["amountInr", "totalInr", "feeRuleKey", "feeRuleVersion"])) return false;
  return isString(fee.amountInr) && isString(fee.totalInr) && isString(fee.feeRuleKey) && isCount(fee.feeRuleVersion);
};

const validatePaymentBlock = (pay: unknown): boolean => {
  if (!isObject(pay) || !exactKeys(pay, ["paymentId", "amountInr", "receiptNumber", "status"], ["settledAt"])) return false;
  return (
    isUuid(pay.paymentId) &&
    isString(pay.amountInr) &&
    isString(pay.receiptNumber) &&
    isString(pay.status) &&
    (pay.settledAt === undefined || (isString(pay.settledAt) && !Number.isNaN(Date.parse(pay.settledAt))))
  );
};

const validateDirectorDecision = (d: unknown): boolean => {
  if (!isObject(d) || !exactKeys(d, ["decision", "decidedAt"], ["note"])) return false;
  return (
    (d.decision === "approve" || d.decision === "reject" || d.decision === "return") &&
    isString(d.decidedAt) &&
    !Number.isNaN(Date.parse(d.decidedAt)) &&
    (d.note === undefined || d.note === null || isString(d.note))
  );
};

const validatePermitteeActivation = (a: unknown): boolean => {
  if (!isObject(a) || !exactKeys(a, ["permitteeNumber", "activatedAt"])) return false;
  return isString(a.permitteeNumber) && isString(a.activatedAt) && !Number.isNaN(Date.parse(a.activatedAt));
};

const validateObservation = (o: unknown): boolean => {
  if (!isObject(o) || !exactKeys(o, ["startedOn", "endsOn"], ["closedAt"])) return false;
  return (
    isString(o.startedOn) &&
    DATE.test(o.startedOn) &&
    isString(o.endsOn) &&
    DATE.test(o.endsOn) &&
    (o.closedAt === undefined || (isString(o.closedAt) && !Number.isNaN(Date.parse(o.closedAt))))
  );
};

const validateDraftObject = (draft: unknown): boolean => {
  if (!isObject(draft)) return false;
  const allowed = ["cin", "gstin", "declarationAccepted", "agreementAccepted", "registeredAddress", "authorisedSignatory", "facilities", "contacts", "annexureNotes", "sop"];
  if (!exactKeys(draft, [], allowed)) return false;
  return true;
};

export const validateManufacturerOnboardingDetailSections = (body: Record<string, unknown>): boolean => {
  if (body.draft !== undefined && !validateDraftObject(body.draft)) return false;
  if (body.documents !== undefined && (!Array.isArray(body.documents) || !body.documents.every(validateDocumentHead))) return false;
  if (body.automatedChecks !== undefined && (!Array.isArray(body.automatedChecks) || !body.automatedChecks.every(validateAutomatedCheck))) return false;
  if (body.lifecycle !== undefined && (!Array.isArray(body.lifecycle) || !body.lifecycle.every(validateLifecycleEvent))) return false;
  if (body.anomalies !== undefined && (!Array.isArray(body.anomalies) || !body.anomalies.every(validateAnomaly))) return false;
  if (body.outcome !== undefined && !isString(body.outcome)) return false;
  if (body.paymentId !== undefined && !isUuid(body.paymentId)) return false;
  if (body.fee !== undefined && !validateFeeBlock(body.fee)) return false;
  if (body.payment !== undefined && !validatePaymentBlock(body.payment)) return false;
  if (body.directorDecision !== undefined && !validateDirectorDecision(body.directorDecision)) return false;
  if (body.permitteeActivation !== undefined && !validatePermitteeActivation(body.permitteeActivation)) return false;
  if (body.observation !== undefined && !validateObservation(body.observation)) return false;
  return true;
};

export const validateManufacturerOnboardingItem: Validator<ManufacturerOnboardingItem> = (body) => {
  if (!exactKeys(body, [...SUMMARY_REQUIRED], [...SUMMARY_OPTIONAL])) return null;
  if (!validateManufacturerOnboardingItemFields(body)) return null;
  return body as unknown as ManufacturerOnboardingItem;
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
  403: [...RESOLVER_DENIALS, "no_read_scope"],
  409: [...IDEMPOTENCY],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};
export const SPRING_MANUFACTURER_ONBOARDING_PATCH_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "no_read_scope", "not_editable"],
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
  403: [...RESOLVER_DENIALS, "no_read_scope", "not_submittable"],
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

export const validateManufacturerOnboardingDetail: Validator<ManufacturerOnboardingItem & Record<string, unknown>> = (body) => {
  if (!exactKeys(body, [...SUMMARY_REQUIRED], [...DETAIL_OPTIONAL])) return null;
  if (!validateManufacturerOnboardingItemFields(body)) return null;
  if (!validateManufacturerOnboardingDetailSections(body as Record<string, unknown>)) return null;
  return body as ManufacturerOnboardingItem & Record<string, unknown>;
};

export interface ManufacturerOnboardingDocumentList {
  applicationId: string;
  documents: { documentKind: string; latestVersion: number; status: string; expiresOn?: string }[];
}

export const validateManufacturerOnboardingDocumentList: Validator<ManufacturerOnboardingDocumentList> = (body) => {
  if (!exactKeys(body, ["applicationId", "documents"])) return null;
  const b = body;
  if (!isUuid(b.applicationId) || !Array.isArray(b.documents)) return null;
  const ok = b.documents.every(validateDocumentHead);
  return ok ? (b as unknown as ManufacturerOnboardingDocumentList) : null;
};

const COMMAND_ERRORS: UpstreamErrors = {
  401: ["unauthenticated"],
  403: [...RESOLVER_DENIALS, "not_permitted", "segregation_refused", "organisation_not_eligible"],
  404: ["not_found"],
  409: ["version_conflict", "anomaly_open", "observation_not_ended", ...IDEMPOTENCY],
  422: ["validation_failed", "idempotency_key_required"],
  503: ["service_unavailable"],
};

export const SPRING_MANUFACTURER_ONBOARDING_LIST = { errors: SPRING_MANUFACTURER_ONBOARDING_LIST_ERRORS, validate: validateManufacturerOnboardingList };
export const SPRING_MANUFACTURER_ONBOARDING_READ = { errors: SPRING_MANUFACTURER_ONBOARDING_READ_ERRORS, validate: validateManufacturerOnboardingDetail };
export const SPRING_MANUFACTURER_ONBOARDING_CREATE = {
  errors: SPRING_MANUFACTURER_ONBOARDING_CREATE_ERRORS,
  validate: validateManufacturerOnboardingDetail,
  successStatuses: [201] as const,
};
export const SPRING_MANUFACTURER_ONBOARDING_PATCH = {
  errors: SPRING_MANUFACTURER_ONBOARDING_PATCH_ERRORS,
  validate: validateManufacturerOnboardingDetail,
  successStatuses: [200] as const,
};
export const SPRING_MANUFACTURER_ONBOARDING_PREVIEW = {
  errors: SPRING_MANUFACTURER_ONBOARDING_PREVIEW_ERRORS,
  validate: validateManufacturerOnboardingSubmitPreview,
};
export const SPRING_MANUFACTURER_ONBOARDING_SUBMIT = {
  errors: SPRING_MANUFACTURER_ONBOARDING_SUBMIT_ERRORS,
  validate: validateManufacturerOnboardingDetail,
  successStatuses: [200] as const,
};
export const SPRING_MANUFACTURER_ONBOARDING_DIRECTOR_DECISION = {
  errors: COMMAND_ERRORS,
  validate: validateManufacturerOnboardingDetail,
  successStatuses: [200] as const,
};
export const SPRING_MANUFACTURER_ONBOARDING_RAISE_ANOMALY = {
  errors: COMMAND_ERRORS,
  validate: validateManufacturerOnboardingDetail,
  successStatuses: [200] as const,
};
export const SPRING_MANUFACTURER_ONBOARDING_RESOLVE_ANOMALY = {
  errors: COMMAND_ERRORS,
  validate: validateManufacturerOnboardingDetail,
  successStatuses: [200] as const,
};
export const SPRING_MANUFACTURER_ONBOARDING_DOC_LIST = {
  errors: SPRING_MANUFACTURER_ONBOARDING_READ_ERRORS,
  validate: validateManufacturerOnboardingDocumentList,
};
export const SPRING_MANUFACTURER_ONBOARDING_DOC_UPLOAD = {
  errors: {
    401: ["unauthenticated"],
    403: [...WRITE, "not_editable"],
    404: ["not_found"],
    422: ["validation_failed"],
    503: ["service_unavailable"],
  } satisfies UpstreamErrors,
  validate: validateManufacturerOnboardingDetail,
  successStatuses: [200] as const,
};

/** Sample full detail body for unit-evidence (BFF upstream validation). */
export const MANUFACTURER_ONBOARDING_DETAIL_FIXTURE = {
  id: "00000000-0000-4000-f000-000000000001",
  reference: "MOB/2026/00001",
  organisationId: "00000000-0000-4000-b000-000000000007",
  legalName: "Onboard Manufacturing Pvt Ltd",
  state: "director_review",
  version: 2,
  tradeLicenceUploaded: true,
  createdAt: "2026-10-01T12:00:00.000Z",
  draft: {
    cin: "U12345AB6789XYZ123456",
    gstin: "22AAAAA0000A1Z5",
    declarationAccepted: true,
    agreementAccepted: true,
    registeredAddress: { line1: "1 Industrial Area", city: "Delhi", state: "DL", pincode: "110001" },
    authorisedSignatory: { name: "A. Signatory", designation: "Director" },
  },
  documents: [{ documentKind: "trade_licence", latestVersion: 1, status: "uploaded" }],
  automatedChecks: [{ checkCode: "cin_format", outcome: "pass", checkedAt: "2026-10-01T12:01:00.000Z" }],
  lifecycle: [{ eventKind: "submit", fromState: "draft", toState: "submitted", actorRole: "manufacturer", occurredAt: "2026-10-01T12:01:00.000Z" }],
  anomalies: [],
  fee: { amountInr: "5000.00", totalInr: "5000.00", feeRuleKey: "REG:manufacturer_onboarding", feeRuleVersion: 1 },
  payment: {
    paymentId: "00000000-0000-4000-f000-000000000002",
    amountInr: "5000.00",
    receiptNumber: "SIMRCPT-20261001-0001",
    status: "paid",
    settledAt: "2026-10-01T12:01:30.000Z",
  },
  paymentId: "00000000-0000-4000-f000-000000000002",
} as const;
