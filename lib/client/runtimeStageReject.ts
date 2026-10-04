/**
 * Browser client for POST /api/runtime/model-applications/{id}/reject, on the screen kit. The owner of a scrutiny, rating or
 * approval stage rejects the application permanently, with a reason. Rejected is terminal. Use it from a screen with
 * useCommand + CommandPanel (components/app/kit/CommandPanel.tsx).
 */
import { runtimeCommand } from "@/lib/client/runtimeHttp";

export type StageRejectReceipt = {
  applicationId: string;
  reference: string;
  fromState: "iame_scrutiny" | "bee_scrutiny" | "rating" | "director_review" | "secretary_approval";
  toState: "rejected";
  version: number;
  reason: string;
  rejectedAt: string;
};

export type StageRejectInput = {
  id: string;
  /** The record version the officer saw. */
  version: number;
  reason: string;
};

export const stageRejectPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/reject`;

const parse = (body: unknown): StageRejectReceipt | null =>
  body && typeof body === "object" && "applicationId" in body && "rejectedAt" in body ? (body as StageRejectReceipt) : null;

export function runStageReject(p: StageRejectInput, idempotencyKey: string) {
  return runtimeCommand(stageRejectPath(p.id), "POST", { version: p.version, reason: p.reason }, idempotencyKey, parse);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const stageRejectSignature = (p: StageRejectInput) => [p.id, p.version, p.reason];
