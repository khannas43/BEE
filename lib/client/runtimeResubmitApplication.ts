/**
 * Browser client for POST /api/runtime/model-applications/{id}/resubmit, on the screen kit. The applicant resubmits a
 * returned application after editing it. Use it from a screen with useCommand + CommandPanel.
 */
import { runtimeCommand } from "@/lib/client/runtimeHttp";

export type ResubmitApplicationReceipt = {
  applicationId: string;
  reference: string;
  fromState: "returned";
  toState: "iame_scrutiny" | "bee_scrutiny" | "rating" | "director_review" | "secretary_approval";
  version: number;
  ratingSuperseded: boolean;
  resubmittedAt: string;
};

export type ResubmitApplicationInput = {
  id: string;
  /** The record version the applicant saw. */
  version: number;
  /** Optional note on what changed. */
  note?: string;
};

export const resubmitApplicationPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/resubmit`;

const parse = (body: unknown): ResubmitApplicationReceipt | null =>
  body && typeof body === "object" && "applicationId" in body && "ratingSuperseded" in body ? (body as ResubmitApplicationReceipt) : null;

export function runResubmitApplication(p: ResubmitApplicationInput, idempotencyKey: string) {
  const note = p.note?.trim();
  return runtimeCommand(resubmitApplicationPath(p.id), "POST", note ? { version: p.version, note } : { version: p.version }, idempotencyKey, parse);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const resubmitApplicationSignature = (p: ResubmitApplicationInput) => [p.id, p.version, p.note?.trim() ?? ""];
