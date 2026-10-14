/**
 * Browser client for brand and agency registration (WP04.2b-1). Reads and commands go through the screen kit.
 * Provisional local rules, not BEE rules. Spring decides who may file, edit or submit; this only carries the request.
 */
import {
  type CommandResult,
  type FetchLike,
  INVALID_RESPONSE,
  parseJson,
  type ReadFailure,
  readFailure,
  runtimeCommand,
  runtimeRead,
  runtimeReadInit,
  UNREACHABLE,
} from "@/lib/client/runtimeHttp";

export type RegistrationState = "draft" | "fee_due" | "programme_review" | "director_approval" | "approved" | "returned" | "rejected";
export type RegistrationKind = "brand" | "agency";
export type RegistrationGateCode = "trade_licence_uploaded" | "start_date_set" | "brand_active" | "brand_name_free";

export type SubmissionFee = {
  amountInr: string;
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
};

export type Registration = {
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
};

export type RegistrationList = { items: Registration[]; count: number; authority: "spring-database" };

export type RegistrationBrand = { brandId: string; brandName: string; principalOrganisation: string };
export type RegistrationBrandList = { items: RegistrationBrand[]; count: number; authority: "spring-database" };

export type RegistrationSubmitPreview = {
  ready: boolean;
  version: number;
  intakeNote: string;
  gates: { code: RegistrationGateCode; met: boolean }[];
  submissionFee?: SubmissionFee;
};

export type RegistrationDocumentVersion = {
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
};

export type RegistrationDocument = {
  id: string;
  documentKind: "trade_licence";
  verificationStatus: "pending_local_verification";
  verificationNote: string;
  versions: RegistrationDocumentVersion[];
  latestVersion?: RegistrationDocumentVersion;
};

export type RegistrationDocumentList = {
  items: RegistrationDocument[];
  count: number;
  authority: "spring-database";
  verificationNote: string;
  localStore: true;
};

export const REGISTRATIONS_PATH = "/api/runtime/registrations";
export const REGISTRATION_BRANDS_PATH = "/api/runtime/registrations/eligible-brands";
export const registrationPath = (id: string) => `${REGISTRATIONS_PATH}/${encodeURIComponent(id)}`;
export const registrationSubmitPath = (id: string) => `${registrationPath(id)}/submit`;
export const registrationDocumentsPath = (id: string) => `${registrationPath(id)}/documents`;
export const registrationContentPath = (id: string, documentId: string, versionId: string) =>
  `${registrationDocumentsPath(id)}/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/content`;

export const registrationListHref = () => "/app/registrations/requests";
export const registrationNewHref = () => "/app/registrations/new";
export const registrationRequestHref = (id: string) => `/app/registrations/request?id=${encodeURIComponent(id)}`;

const parseRegistration = (body: unknown): Registration | null =>
  body && typeof body === "object" && "id" in body && "reference" in body && "state" in body && "version" in body ? (body as Registration) : null;

const parseList = (body: unknown): RegistrationList | null =>
  body && typeof body === "object" && Array.isArray((body as RegistrationList).items) && typeof (body as RegistrationList).count === "number"
    ? (body as RegistrationList)
    : null;

const parseBrands = (body: unknown): RegistrationBrandList | null =>
  body && typeof body === "object" && Array.isArray((body as RegistrationBrandList).items) ? (body as RegistrationBrandList) : null;

const parsePreview = (body: unknown): RegistrationSubmitPreview | null =>
  body && typeof body === "object" && "ready" in body && "version" in body && Array.isArray((body as RegistrationSubmitPreview).gates)
    ? (body as RegistrationSubmitPreview)
    : null;

const parseDocument = (body: unknown): RegistrationDocument | null =>
  body && typeof body === "object" && "id" in body && Array.isArray((body as RegistrationDocument).versions) ? (body as RegistrationDocument) : null;

const parseDocumentList = (body: unknown): RegistrationDocumentList | null =>
  body && typeof body === "object" && Array.isArray((body as RegistrationDocumentList).items) ? (body as RegistrationDocumentList) : null;

export type RegistrationRead = { ok: true; registration: Registration } | { ok: false; failure: ReadFailure };
export type RegistrationListRead = { ok: true; list: RegistrationList } | { ok: false; failure: ReadFailure };
export type RegistrationBrandsRead = { ok: true; brands: RegistrationBrandList } | { ok: false; failure: ReadFailure };
export type RegistrationPreviewRead = { ok: true; preview: RegistrationSubmitPreview } | { ok: false; failure: ReadFailure };
export type RegistrationDocumentsRead = { ok: true; documents: RegistrationDocumentList } | { ok: false; failure: ReadFailure };

export async function readRegistrationList(fetchImpl: FetchLike = fetch): Promise<RegistrationListRead> {
  const r = await runtimeRead(REGISTRATIONS_PATH, parseList, fetchImpl);
  return r.ok ? { ok: true, list: r.value } : r;
}

export async function readRegistration(id: string, fetchImpl: FetchLike = fetch): Promise<RegistrationRead> {
  const r = await runtimeRead(registrationPath(id), parseRegistration, fetchImpl);
  return r.ok ? { ok: true, registration: r.value } : r;
}

export async function readEligibleBrands(fetchImpl: FetchLike = fetch): Promise<RegistrationBrandsRead> {
  const r = await runtimeRead(REGISTRATION_BRANDS_PATH, parseBrands, fetchImpl);
  return r.ok ? { ok: true, brands: r.value } : r;
}

export async function previewRegistrationSubmit(id: string, fetchImpl: FetchLike = fetch): Promise<RegistrationPreviewRead> {
  const r = await runtimeRead(registrationSubmitPath(id), parsePreview, fetchImpl);
  return r.ok ? { ok: true, preview: r.value } : r;
}

export async function listRegistrationDocuments(id: string, fetchImpl: FetchLike = fetch): Promise<RegistrationDocumentsRead> {
  const r = await runtimeRead(registrationDocumentsPath(id), parseDocumentList, fetchImpl);
  return r.ok ? { ok: true, documents: r.value } : r;
}

export type RegistrationWrite =
  | { kind: "brand"; brandName: string }
  | { kind: "agency"; brandId: string; validFrom: string; validTo?: string };

function writeBody(p: RegistrationWrite): Record<string, string> {
  if (p.kind === "brand") return { brandName: p.brandName };
  const body: Record<string, string> = { brandId: p.brandId, validFrom: p.validFrom };
  if (p.validTo) body.validTo = p.validTo;
  return body;
}

export type SaveRegistrationInput = RegistrationWrite & { id?: string; version?: number };

export function runSaveRegistration(p: SaveRegistrationInput, idempotencyKey: string): Promise<CommandResult<Registration>> {
  const fields = writeBody(p);
  if (p.id != null && p.version != null) {
    return runtimeCommand(registrationPath(p.id), "PATCH", { ...fields, version: p.version }, idempotencyKey, parseRegistration);
  }
  return runtimeCommand(REGISTRATIONS_PATH, "POST", fields, idempotencyKey, parseRegistration);
}

export const saveRegistrationSignature = (p: SaveRegistrationInput) =>
  [p.id ?? "", p.version ?? "", p.kind, p.kind === "brand" ? p.brandName : "", p.kind === "agency" ? p.brandId : "", p.kind === "agency" ? p.validFrom : "", p.kind === "agency" ? (p.validTo ?? "") : ""];

export type SubmitRegistrationInput = {
  id: string;
  version: number;
  expectedFee: { amountInr: string; feeRuleKey: string; feeRuleVersion: number };
};

export function runSubmitRegistration(p: SubmitRegistrationInput, idempotencyKey: string) {
  return runtimeCommand(registrationSubmitPath(p.id), "POST", { version: p.version, expectedFee: p.expectedFee }, idempotencyKey, parseRegistration);
}

export const submitRegistrationSignature = (p: SubmitRegistrationInput) => [p.id, p.version, p.expectedFee.amountInr, p.expectedFee.feeRuleKey, p.expectedFee.feeRuleVersion];

export type UploadLicenceInput = { id: string; file: File; label?: string };

export function runUploadLicence(p: UploadLicenceInput, idempotencyKey: string) {
  const form = new FormData();
  form.append("file", p.file, p.file.name);
  if (p.label?.trim()) form.append("label", p.label.trim());
  return runtimeCommand(registrationDocumentsPath(p.id), "POST", form, idempotencyKey, parseDocument);
}

export const uploadLicenceSignature = (p: UploadLicenceInput) => [p.id, p.file.name, p.file.size, p.file.lastModified, p.label ?? ""];

export async function fetchRegistrationContent(id: string, documentId: string, versionId: string, fetchImpl: FetchLike = fetch) {
  let res: Response;
  try {
    res = await fetchImpl(registrationContentPath(id, documentId, versionId), runtimeReadInit());
  } catch {
    return { ok: false as const, failure: UNREACHABLE };
  }
  if (res.ok) {
    if (!(res.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/pdf")) {
      return { ok: false as const, failure: INVALID_RESPONSE };
    }
    const filename = /filename="([^"]{1,180})"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "licence.pdf";
    return { ok: true as const, blob: await res.blob(), filename };
  }
  return { ok: false as const, failure: readFailure(res.status, await parseJson(res)) };
}
