/**
 * Browser client for POST /api/runtime/model-applications/{id}/secretary-approval (first slice step 7), on the screen kit.
 * Use it from a screen with useCommand + CommandPanel (components/app/kit/CommandPanel.tsx).
 */
import { runtimeCommand } from "@/lib/client/runtimeHttp";

export type SecretaryApprovalReceipt = {
  applicationId: string;
  reference: string;
  fromState: "secretary_approval";
  toState: "approved";
  version: number;
  note: string;
  approvedAt: string;
};

export type SecretaryApprovalInput = {
  id: string;
  /** The record version the Secretary saw. */
  version: number;
  note: string;
};

export const secretaryApprovalPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/secretary-approval`;

const parse = (body: unknown): SecretaryApprovalReceipt | null =>
  body && typeof body === "object" && "applicationId" in body && "approvedAt" in body ? (body as SecretaryApprovalReceipt) : null;

export function runSecretaryApproval(p: SecretaryApprovalInput, idempotencyKey: string) {
  return runtimeCommand(secretaryApprovalPath(p.id), "POST", { version: p.version, note: p.note }, idempotencyKey, parse);
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const secretaryApprovalSignature = (p: SecretaryApprovalInput) => [p.id, p.version, p.note];
