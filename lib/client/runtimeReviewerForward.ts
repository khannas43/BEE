/**
 * Browser client for POST /api/runtime/model-applications/{id}/reviewer-forward (first slice step 4), on the screen kit.
 * Use it from a screen with useCommand + CommandPanel (components/app/kit/CommandPanel.tsx).
 */
import { runtimeCommand } from "@/lib/client/runtimeHttp";

export type ReviewerForwardReceipt = {
  applicationId: string;
  reference: string;
  fromState: "bee_scrutiny";
  toState: "rating";
  version: number;
  note: string;
  forwardedAt: string;
};

export type ReviewerForwardInput = {
  id: string;
  /** The record version the reviewer saw. */
  version: number;
  note: string;
};

export const reviewerForwardPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/reviewer-forward`;

const parse = (body: unknown): ReviewerForwardReceipt | null =>
  body && typeof body === "object" && "applicationId" in body && "forwardedAt" in body ? (body as ReviewerForwardReceipt) : null;

export function runReviewerForward(p: ReviewerForwardInput, idempotencyKey: string) {
  return runtimeCommand(reviewerForwardPath(p.id), "POST", { version: p.version, note: p.note }, idempotencyKey, parse);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const reviewerForwardSignature = (p: ReviewerForwardInput) => [p.id, p.version, p.note];
