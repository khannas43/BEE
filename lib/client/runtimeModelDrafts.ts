/**
 * Draft create/edit through the BFF (WP05.1b). Session cookie only; Idempotency-Key required.
 * Transport, failure mapping and the key gate live in the screen kit (runtimeHttp.ts).
 */

import { type CommandFailure, runtimeCommand } from "@/lib/client/runtimeHttp";

// The idempotency key helpers live in the screen kit; re-exported so existing imports keep working.
export { newIdempotencyKey, PayloadKeyGate as DraftIdempotencyGate } from "@/lib/client/runtimeHttp";

export type DraftSaveFailure = CommandFailure;

export type DraftApplication = Record<string, unknown> & { id: string; reference: string; version: number };

export type DraftSaveResult =
  | { ok: true; application: DraftApplication; replayed?: boolean }
  | { ok: false; failure: DraftSaveFailure; replayed?: boolean };

const parseDraft = (body: unknown): DraftApplication | null =>
  body && typeof body === "object" && "id" in body && "reference" in body ? (body as DraftApplication) : null;

async function draftWrite(path: string, method: "POST" | "PATCH", body: object, idempotencyKey: string): Promise<DraftSaveResult> {
  const r = await runtimeCommand(path, method, body, idempotencyKey, parseDraft);
  return r.ok ? { ok: true, application: r.value, replayed: r.replayed } : { ok: false, failure: r.failure, replayed: r.replayed };
}

/** WP05.1d evidence fields. On an edit, an explicit null clears the stored value and an absent field leaves it. */
export type DraftEvidenceFields = {
  laboratoryCode?: string | null;
  testedOn?: string | null;
  declaredIseer?: number | null;
};

export function createModelApplicationDraft(
  body: { brandId: string; category: string; modelNumber: string } & DraftEvidenceFields,
  idempotencyKey: string,
) {
  return draftWrite("/api/runtime/model-applications", "POST", body, idempotencyKey);
}

export function patchModelApplicationDraft(
  id: string,
  body: { version: number; category: string; modelNumber: string; brandId?: string } & DraftEvidenceFields,
  idempotencyKey: string,
) {
  return draftWrite(`/api/runtime/model-applications/${encodeURIComponent(id)}`, "PATCH", body, idempotencyKey);
}

export function modelDraftFormHref(editId?: string | null): string {
  if (!editId) return "/app/model-label/new-model-application";
  return `/app/model-label/new-model-application?edit=${encodeURIComponent(editId)}`;
}
