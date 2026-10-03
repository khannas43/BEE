/**
 * Draft submit → fee_due through the BFF (WP05.1c). Session cookie only; Idempotency-Key required on POST.
 */

import { READ_UI_MESSAGES } from "@/lib/client/runtimeModelApplications";

export type SubmissionFee = {
  amountInr: string;
  currency: string;
  feeRuleKey: string;
  feeRuleVersion: number;
  verificationStatus: string;
  localDemoFee: boolean;
  label: string;
  sourceReference?: string;
};

export type DraftSummary = {
  brandName: string;
  category: string;
  modelNumber: string;
};

/** One WP05.1d evidence gate, in the order submit reports them. Provisional local defaults, not BEE rules. */
export type EvidenceGate = {
  code: "test_report_required" | "declared_efficiency_required" | "test_date_invalid" | "laboratory_not_accredited" | "standard_not_available" | "duplicate_model";
  met: boolean;
};

export type SubmitPreview = {
  ready: boolean;
  version: number;
  intakeNote: string;
  evidenceGates: EvidenceGate[];
  submissionFee?: SubmissionFee;
  draftSummary?: DraftSummary;
};

export type ExpectedFeeSubmit = {
  amountInr: string;
  feeRuleKey: string;
  feeRuleVersion: number;
};
import { newIdempotencyKey } from "@/lib/client/runtimeModelDrafts";

export type SubmitFailure =
  | { kind: "session"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "unavailable"; message: string };

export type SubmitPreviewResult =
  | { ok: true; preview: SubmitPreview }
  | { ok: false; failure: SubmitFailure };

export type SubmitResult =
  | { ok: true; application: Record<string, unknown> & { id: string; reference: string; state: string; version: number }; submissionFee: SubmissionFee; replayed?: boolean }
  | { ok: false; failure: SubmitFailure; replayed?: boolean };

const idemPattern = /^[A-Za-z0-9-]{16,64}$/;

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string") {
    return (body as { message: string }).message;
  }
  return fallback;
}

function classifyFailure(status: number, parsed: unknown): SubmitFailure {
  const code = parsed && typeof parsed === "object" && "error" in parsed ? String((parsed as { error: unknown }).error) : "";
  if (status === 401) return { kind: "session", message: messageFrom(parsed, READ_UI_MESSAGES.no_session) };
  if (status === 403) return { kind: "denied", message: messageFrom(parsed, "This request is not permitted.") };
  if (status === 409) {
    const fallback = code === "fee_preview_conflict"
      ? "The provisional fee changed since it was reviewed."
      : "The record has changed since it was loaded.";
    return { kind: "conflict", message: messageFrom(parsed, fallback) };
  }
  if (status === 422) return { kind: "validation", message: messageFrom(parsed, "The request could not be accepted.") };
  if (code === "api_unreachable") return { kind: "unavailable", message: READ_UI_MESSAGES.api_unreachable };
  return { kind: "unavailable", message: messageFrom(parsed, READ_UI_MESSAGES.api_error) };
}

export async function previewModelApplicationSubmit(id: string): Promise<SubmitPreviewResult> {
  let res: Response;
  try {
    res = await fetch(`/api/runtime/model-applications/${encodeURIComponent(id)}/submit`, { credentials: "include", cache: "no-store" });
  } catch {
    return { ok: false, failure: { kind: "unavailable", message: READ_UI_MESSAGES.api_unreachable } };
  }
  const parsed = await res.json().catch(() => null);
  if (res.ok && parsed && typeof parsed === "object" && "ready" in parsed && "version" in parsed) {
    return { ok: true, preview: parsed as SubmitPreview };
  }
  return { ok: false, failure: classifyFailure(res.status, parsed) };
}

export async function submitModelApplicationDraft(
  id: string,
  version: number,
  expectedFee: ExpectedFeeSubmit,
  idempotencyKey = newIdempotencyKey(),
): Promise<SubmitResult> {
  if (!idemPattern.test(idempotencyKey)) {
    return { ok: false, failure: { kind: "validation", message: "An Idempotency-Key header is required for this request." } };
  }
  let res: Response;
  try {
    res = await fetch(`/api/runtime/model-applications/${encodeURIComponent(id)}/submit`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ version, expectedFee }),
    });
  } catch {
    return { ok: false, failure: { kind: "unavailable", message: READ_UI_MESSAGES.api_unreachable } };
  }
  const replayed = res.headers.get("Idempotency-Replayed") === "true";
  const parsed = await res.json().catch(() => null);
  if (res.ok && parsed && typeof parsed === "object" && "id" in parsed && "submissionFee" in parsed) {
    const app = parsed as Record<string, unknown> & { id: string; reference: string; state: string; version: number };
    return { ok: true, application: app, submissionFee: (parsed as { submissionFee: SubmissionFee }).submissionFee, replayed };
  }
  return { ok: false, failure: classifyFailure(res.status, parsed), replayed };
}
