/**
 * The history of one model application through the BFF (WP07.1i). Session cookie only. Read-only: Spring decides who may read
 * it (exactly who may read the application) and what each reader sees of it. Provisional local rules, not BEE rules.
 */

import { type FetchLike, type ReadFailure, runtimeRead } from "@/lib/client/runtimeHttp";

export type HistoryAction =
  | "submit" | "confirm_fee" | "iame_recommend" | "reviewer_forward" | "compute_rating" | "director_recommend" | "secretary_approve"
  | "return" | "resubmit" | "reject";

export type HistoryEvent = {
  sequence: number;
  at: string;
  action: HistoryAction;
  fromState: string;
  toState: string;
  actorRole: string;
  /** Only an officer sees who took the step. */
  actorName?: string;
  actorOrganisation: string;
  /** The note or reason that went with the step, when this reader may see it. */
  note?: string;
  facts: { label: string; value: string }[];
  /** True when the step has an internal note or finding that this reader may not see. */
  withheld: boolean;
};

export type ApplicationHistory = {
  applicationId: string;
  reference: string;
  viewedAs: "applicant" | "officer";
  items: HistoryEvent[];
  count: number;
};

export type HistoryResult = { ok: true; history: ApplicationHistory } | { ok: false; failure: ReadFailure };

export const historyPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/history`;

const parse = (body: unknown): ApplicationHistory | null =>
  body && typeof body === "object" && Array.isArray((body as ApplicationHistory).items) && "viewedAs" in body ? (body as ApplicationHistory) : null;

export async function readModelHistory(applicationId: string, fetchImpl: FetchLike = fetch): Promise<HistoryResult> {
  const r = await runtimeRead(historyPath(applicationId), parse, fetchImpl);
  return r.ok ? { ok: true, history: r.value } : r;
}

/** The plain words for each step, for a reader. */
export const HISTORY_ACTION_LABELS: Record<HistoryAction, string> = {
  submit: "Submitted",
  confirm_fee: "Fee confirmed",
  iame_recommend: "IAME scrutiny recommended",
  reviewer_forward: "Reviewer forwarded to rating",
  compute_rating: "Rating computed",
  director_recommend: "Director recommended approval",
  secretary_approve: "Secretary gave final approval",
  return: "Returned to the applicant",
  resubmit: "Resubmitted by the applicant",
  reject: "Rejected",
};
