/**
 * Browser client for POST /api/runtime/model-applications/{id}/return, on the screen kit. The owner of a scrutiny or
 * approval stage returns the application to the applicant with a reason. Use it from a screen with useCommand +
 * CommandPanel (components/app/kit/CommandPanel.tsx).
 */
import { runtimeCommand } from "@/lib/client/runtimeHttp";

export type StageReturnReceipt = {
  applicationId: string;
  reference: string;
  fromState: "iame_scrutiny" | "bee_scrutiny" | "director_review" | "secretary_approval";
  toState: "returned";
  version: number;
  reason: string;
  returnedAt: string;
};

export type StageReturnInput = {
  id: string;
  /** The record version the officer saw. */
  version: number;
  reason: string;
};

export const stageReturnPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/return`;

const parse = (body: unknown): StageReturnReceipt | null =>
  body && typeof body === "object" && "applicationId" in body && "returnedAt" in body ? (body as StageReturnReceipt) : null;

export function runStageReturn(p: StageReturnInput, idempotencyKey: string) {
  return runtimeCommand(stageReturnPath(p.id), "POST", { version: p.version, reason: p.reason }, idempotencyKey, parse);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const stageReturnSignature = (p: StageReturnInput) => [p.id, p.version, p.reason];
