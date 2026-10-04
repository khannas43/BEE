/**
 * Browser client for POST /api/runtime/model-applications/{id}/iame-recommendation (first slice step 3), on the screen kit.
 * Use it from a screen with useCommand + CommandPanel (components/app/kit/CommandPanel.tsx).
 */
import { runtimeCommand } from "@/lib/client/runtimeHttp";

export type IameVerification = "verified" | "not_verified";

export type IameRecommendationReceipt = {
  applicationId: string;
  reference: string;
  fromState: "iame_scrutiny";
  toState: "bee_scrutiny";
  version: number;
  verification: IameVerification;
  note: string;
  recommendedAt: string;
};

export type IameRecommendationInput = {
  id: string;
  /** The record version the officer saw. */
  version: number;
  verification: IameVerification;
  note: string;
};

export const iameRecommendationPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/iame-recommendation`;

const parse = (body: unknown): IameRecommendationReceipt | null =>
  body && typeof body === "object" && "applicationId" in body && "verification" in body ? (body as IameRecommendationReceipt) : null;

export function runIameRecommendation(p: IameRecommendationInput, idempotencyKey: string) {
  return runtimeCommand(
    iameRecommendationPath(p.id),
    "POST",
    { version: p.version, verification: p.verification, note: p.note },
    idempotencyKey,
    parse,
  );
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const iameRecommendationSignature = (p: IameRecommendationInput) => [p.id, p.version, p.verification, p.note];
