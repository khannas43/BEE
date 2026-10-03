/**
 * Browser client for POST /api/runtime/model-applications/{id}/fee-confirmation (first slice step 2), on the screen kit.
 * Use it from a screen with useCommand + CommandPanel (components/app/kit/CommandPanel.tsx).
 */
import { runtimeCommand } from "@/lib/client/runtimeHttp";

export type FeeConfirmationReceipt = {
  applicationId: string;
  reference: string;
  fromState: "fee_due";
  toState: "iame_scrutiny";
  version: number;
  receiptReference: string;
  amountInr: string;
  receivedOn: string;
  confirmedAt: string;
};

export type FeeConfirmationInput = {
  id: string;
  /** The record version the user saw. */
  version: number;
  receiptReference: string;
  receivedOn: string;
  amountInr: string;
};

export const feeConfirmationPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}/fee-confirmation`;

const parse = (body: unknown): FeeConfirmationReceipt | null =>
  body && typeof body === "object" && "applicationId" in body && "receiptReference" in body ? (body as FeeConfirmationReceipt) : null;

export function runFeeConfirmation(p: FeeConfirmationInput, idempotencyKey: string) {
  return runtimeCommand(
    feeConfirmationPath(p.id),
    "POST",
    { version: p.version, receiptReference: p.receiptReference, receivedOn: p.receivedOn, amountInr: p.amountInr },
    idempotencyKey,
    parse,
  );
}

/** The payload signature for useCommand: the same signature reuses the key, a different one gets a new key. */
export const feeConfirmationSignature = (p: FeeConfirmationInput) => [p.id, p.version, p.receiptReference, p.receivedOn, p.amountInr];
