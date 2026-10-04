/**
 * Browser client for POST /api/runtime/model-applications/{id}/director-recommendation (first slice step 6), on the screen
 * kit. Use it from a screen with useCommand + CommandPanel (components/app/kit/CommandPanel.tsx).
 * PROVISIONAL LOCAL ASSUMPTION (decision D1, chosen by the owner): for some categories the recommendation is final.
 */
import { runtimeCommand } from "@/lib/client/runtimeHttp";

export type DirectorRecommendationReceipt = {
  applicationId: string;
  reference: string;
  fromState: "director_review";
  toState: "secretary_approval" | "approved";
  version: number;
  note: string;
  directorFinal: boolean;
  recommendedAt: string;
};

export type DirectorRecommendationInput = {
  id: string;
  /** The record version the Director saw. */
  version: number;
  note: string;
};

export const directorRecommendationPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/director-recommendation`;

const parse = (body: unknown): DirectorRecommendationReceipt | null =>
  body && typeof body === "object" && "applicationId" in body && "directorFinal" in body ? (body as DirectorRecommendationReceipt) : null;

export function runDirectorRecommendation(p: DirectorRecommendationInput, idempotencyKey: string) {
  return runtimeCommand(directorRecommendationPath(p.id), "POST", { version: p.version, note: p.note }, idempotencyKey, parse);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const directorRecommendationSignature = (p: DirectorRecommendationInput) => [p.id, p.version, p.note];
