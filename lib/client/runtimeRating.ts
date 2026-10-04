/**
 * Browser client for POST /api/runtime/model-applications/{id}/rating (first slice step 5), on the screen kit.
 * Use it from a screen with useCommand + CommandPanel (components/app/kit/CommandPanel.tsx).
 * PROVISIONAL LOCAL DEMONSTRATION: the stars come from a local demonstration scheme, not a BEE-approved formula.
 */
import { runtimeCommand } from "@/lib/client/runtimeHttp";

export type RatingReceipt = {
  applicationId: string;
  reference: string;
  fromState: "rating";
  toState: "director_review";
  version: number;
  ratingVersion: number;
  schemeKey: string;
  declaredIseer: string;
  verifiedIseer: string;
  stars: number;
  localDemoRating: true;
  computedAt: string;
};

export type RatingInput = {
  id: string;
  /** The record version the officer saw. */
  version: number;
  /** The efficiency figure the officer verified from the test report, as text (up to two digits and two decimals). */
  verifiedIseer: string;
};

export const ratingPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/rating`;

const parse = (body: unknown): RatingReceipt | null =>
  body && typeof body === "object" && "applicationId" in body && "stars" in body ? (body as RatingReceipt) : null;

export function runRating(p: RatingInput, idempotencyKey: string) {
  return runtimeCommand(ratingPath(p.id), "POST", { version: p.version, verifiedIseer: p.verifiedIseer }, idempotencyKey, parse);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const ratingSignature = (p: RatingInput) => [p.id, p.version, p.verifiedIseer];
