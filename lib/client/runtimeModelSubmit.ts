/**
 * Draft submit → fee_due through the BFF (WP05.1c). Session cookie only; Idempotency-Key required on POST.
 */

import { type CommandFailure, type ReadFailure, runtimeCommand, runtimeRead, newIdempotencyKey } from "@/lib/client/runtimeHttp";

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

export type SubmitFailure = CommandFailure;

export type SubmitPreviewResult =
  | { ok: true; preview: SubmitPreview }
  | { ok: false; failure: ReadFailure };

export type SubmittedApplication = Record<string, unknown> & { id: string; reference: string; state: string; version: number; submissionFee: SubmissionFee };

export type SubmitResult =
  | { ok: true; application: SubmittedApplication; submissionFee: SubmissionFee; replayed?: boolean }
  | { ok: false; failure: SubmitFailure; replayed?: boolean };

const submitPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/submit`;

const parsePreview = (body: unknown): SubmitPreview | null =>
  body && typeof body === "object" && "ready" in body && "version" in body ? (body as SubmitPreview) : null;

const parseSubmitted = (body: unknown): SubmittedApplication | null =>
  body && typeof body === "object" && "id" in body && "submissionFee" in body ? (body as unknown as SubmittedApplication) : null;

export async function previewModelApplicationSubmit(id: string): Promise<SubmitPreviewResult> {
  const r = await runtimeRead(submitPath(id), parsePreview);
  return r.ok ? { ok: true, preview: r.value } : r;
}

export async function submitModelApplicationDraft(
  id: string,
  version: number,
  expectedFee: ExpectedFeeSubmit,
  idempotencyKey = newIdempotencyKey(),
): Promise<SubmitResult> {
  const r = await runtimeCommand(submitPath(id), "POST", { version, expectedFee }, idempotencyKey, parseSubmitted);
  return r.ok
    ? { ok: true, application: r.value, submissionFee: r.value.submissionFee, replayed: r.replayed }
    : { ok: false, failure: r.failure, replayed: r.replayed };
}
