/**
 * Local test-report document intake through the BFF (WP06.1a). Session cookie only; the
 * upload carries an Idempotency-Key. Documents are held in a local store and stay
 * pending local verification: nothing here claims laboratory accreditation or BEE approval.
 */

import { READ_UI_MESSAGES, runtimeReadInit } from "@/lib/client/runtimeModelApplications";
import { newIdempotencyKey } from "@/lib/client/runtimeModelDrafts";

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

export type DocumentFailure =
  | { kind: "session"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "unavailable"; message: string };

export type DocumentListResult =
  | { ok: true; list: ModelDocumentList }
  | { ok: false; failure: DocumentFailure };

export type DocumentUploadInput = {
  file: File;
  reportLabel: string;
  testedOn?: string;
  laboratoryName?: string;
};

export type DocumentUploadResult =
  | { ok: true; document: ModelDocument; replayed?: boolean }
  | { ok: false; failure: DocumentFailure; replayed?: boolean };

export type DocumentContentResult =
  | { ok: true; blob: Blob; filename: string }
  | { ok: false; failure: DocumentFailure };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const idemPattern = /^[A-Za-z0-9-]{16,64}$/;
const UNREACHABLE: DocumentFailure = { kind: "unavailable", message: READ_UI_MESSAGES.api_unreachable };

const documentsPath = (applicationId: string) => `/api/runtime/model-applications/${encodeURIComponent(applicationId)}/documents`;

/** Same-origin URL of one version's PDF (use for a link or `fetch`; the cookie authorises it). */
export const documentContentPath = (applicationId: string, documentId: string, versionId: string) =>
  `${documentsPath(applicationId)}/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/content`;

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string") {
    return (body as { message: string }).message;
  }
  return fallback;
}

function classifyFailure(status: number, parsed: unknown): DocumentFailure {
  const code = parsed && typeof parsed === "object" && "error" in parsed ? String((parsed as { error: unknown }).error) : "";
  if (status === 401) return { kind: "session", message: messageFrom(parsed, READ_UI_MESSAGES.no_session) };
  if (status === 403) return { kind: "denied", message: messageFrom(parsed, "This request is not permitted.") };
  // Same copy for unknown, cross-organisation and malformed IDs — never say which.
  if (status === 404) return { kind: "not_found", message: READ_UI_MESSAGES.not_found };
  if (status === 409) return { kind: "conflict", message: messageFrom(parsed, "This Idempotency-Key was already used with a different request body.") };
  if (status === 422) return { kind: "validation", message: messageFrom(parsed, "The request could not be accepted.") };
  if (code === "api_unreachable") return UNREACHABLE;
  return { kind: "unavailable", message: messageFrom(parsed, READ_UI_MESSAGES.api_error) };
}

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
  let res: Response;
  try {
    res = await fetchImpl(documentsPath(applicationId), runtimeReadInit());
  } catch {
    return { ok: false, failure: UNREACHABLE };
  }
  const parsed = await res.json().catch(() => null);
  if (res.ok) {
    const list = asList(parsed);
    return list ? { ok: true, list } : { ok: false, failure: { kind: "unavailable", message: READ_UI_MESSAGES.invalid_api_response } };
  }
  return { ok: false, failure: classifyFailure(res.status, parsed) };
}

/**
 * POST /api/runtime/model-applications/{id}/documents as multipart/form-data. Content-Type is
 * left to the browser so the multipart boundary is set; reuse one idempotency key to retry
 * the same upload after a lost response.
 */
export async function uploadModelDocument(
  applicationId: string,
  input: DocumentUploadInput,
  idempotencyKey = newIdempotencyKey(),
  fetchImpl: FetchLike = fetch,
): Promise<DocumentUploadResult> {
  if (!idemPattern.test(idempotencyKey)) {
    return { ok: false, failure: { kind: "validation", message: "An Idempotency-Key header is required for this request." } };
  }
  const form = new FormData();
  form.append("file", input.file, input.file.name);
  form.append("documentKind", "test_report");
  form.append("reportLabel", input.reportLabel);
  if (input.testedOn) form.append("testedOn", input.testedOn);
  if (input.laboratoryName) form.append("laboratoryName", input.laboratoryName);
  let res: Response;
  try {
    res = await fetchImpl(documentsPath(applicationId), {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Idempotency-Key": idempotencyKey },
      body: form,
    });
  } catch {
    return { ok: false, failure: UNREACHABLE };
  }
  const replayed = res.headers.get("Idempotency-Replayed") === "true";
  const parsed = await res.json().catch(() => null);
  if (res.status === 201 && isDocument(parsed)) return { ok: true, document: parsed, replayed };
  return { ok: false, failure: classifyFailure(res.status, parsed), replayed };
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
      return { ok: false, failure: { kind: "unavailable", message: READ_UI_MESSAGES.invalid_api_response } };
    }
    const filename = /filename="([^"]{1,180})"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "document.pdf";
    return { ok: true, blob: await res.blob(), filename };
  }
  return { ok: false, failure: classifyFailure(res.status, await res.json().catch(() => null)) };
}
