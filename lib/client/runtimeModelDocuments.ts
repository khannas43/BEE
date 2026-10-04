/**
 * Local test-report document intake through the BFF (WP06.1a). Session cookie only; the
 * upload carries an Idempotency-Key. Documents are held in a local store and stay
 * pending local verification: nothing here claims laboratory accreditation or BEE approval.
 */

import {
  type CommandFailure,
  type CommandResult,
  type FetchLike,
  INVALID_RESPONSE,
  newIdempotencyKey,
  parseJson,
  type ReadFailure,
  readFailure,
  runtimeCommand,
  runtimeRead,
  runtimeReadInit,
  UNREACHABLE,
} from "@/lib/client/runtimeHttp";

export type DocumentVersion = {
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
};

export type ModelDocument = {
  id: string;
  documentKind: "test_report";
  verificationStatus: "pending_local_verification";
  verificationNote: string;
  versions: DocumentVersion[];
  latestVersion?: DocumentVersion;
};

export type ModelDocumentList = {
  items: ModelDocument[];
  count: number;
  authority: "spring-database";
  verificationNote: string;
  localStore: true;
};

export type DocumentFailure = CommandFailure;

export type DocumentListResult =
  | { ok: true; list: ModelDocumentList }
  | { ok: false; failure: ReadFailure };

export type DocumentUploadInput = {
  file: File;
  reportLabel: string;
  testedOn?: string;
  laboratoryName?: string;
};

/** The command result of an upload: `value` is the logical document with all its versions. */
export type DocumentUploadResult = CommandResult<ModelDocument>;

export type DocumentContentResult =
  | { ok: true; blob: Blob; filename: string }
  | { ok: false; failure: ReadFailure };

const documentsPath = (applicationId: string) => `/api/runtime/model-applications/${encodeURIComponent(applicationId)}/documents`;

/** Same-origin URL of one version's PDF (use for a link or `fetch`; the cookie authorises it). */
export const documentContentPath = (applicationId: string, documentId: string, versionId: string) =>
  `${documentsPath(applicationId)}/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/content`;

const isDocument = (v: unknown): v is ModelDocument =>
  !!v && typeof v === "object" && typeof (v as ModelDocument).id === "string" && Array.isArray((v as ModelDocument).versions);

function asList(v: unknown): ModelDocumentList | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>;
  if (b.authority !== "spring-database" || !Array.isArray(b.items) || typeof b.count !== "number" || !b.items.every(isDocument)) return null;
  return v as ModelDocumentList;
}

/** GET /api/runtime/model-applications/{id}/documents. */
export async function listModelDocuments(applicationId: string, fetchImpl: FetchLike = fetch): Promise<DocumentListResult> {
  const r = await runtimeRead(documentsPath(applicationId), asList, fetchImpl);
  return r.ok ? { ok: true, list: r.value } : r;
}

/**
 * POST /api/runtime/model-applications/{id}/documents as multipart/form-data. The browser sets the multipart boundary;
 * reuse one idempotency key to retry the same upload after a lost response (see PayloadKeyGate / useCommand).
 */
export async function uploadModelDocument(
  applicationId: string,
  input: DocumentUploadInput,
  idempotencyKey = newIdempotencyKey(),
  fetchImpl: FetchLike = fetch,
): Promise<DocumentUploadResult> {
  const form = new FormData();
  form.append("file", input.file, input.file.name);
  form.append("documentKind", "test_report");
  form.append("reportLabel", input.reportLabel);
  if (input.testedOn) form.append("testedOn", input.testedOn);
  if (input.laboratoryName) form.append("laboratoryName", input.laboratoryName);
  return runtimeCommand(documentsPath(applicationId), "POST", form, idempotencyKey, (b) => (isDocument(b) ? b : null), fetchImpl);
}

/** GET one version's PDF as a Blob (for a download or object-URL preview). */
export async function fetchModelDocumentContent(
  applicationId: string,
  documentId: string,
  versionId: string,
  fetchImpl: FetchLike = fetch,
): Promise<DocumentContentResult> {
  let res: Response;
  try {
    res = await fetchImpl(documentContentPath(applicationId, documentId, versionId), runtimeReadInit());
  } catch {
    return { ok: false, failure: UNREACHABLE };
  }
  if (res.ok) {
    if (!(res.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/pdf")) {
      return { ok: false, failure: INVALID_RESPONSE };
    }
    const filename = /filename="([^"]{1,180})"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "document.pdf";
    return { ok: true, blob: await res.blob(), filename };
  }
  return { ok: false, failure: readFailure(res.status, await parseJson(res)) };
}
