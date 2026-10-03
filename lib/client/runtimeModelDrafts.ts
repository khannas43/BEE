/**
 * Draft create/edit through the BFF (WP05.1b). Session cookie only; Idempotency-Key required.
 */

import { IDEMPOTENCY_KEY } from "@/lib/client/runtimeHttp";
import { READ_UI_MESSAGES } from "@/lib/client/runtimeModelApplications";

export type DraftSaveFailure =
  | { kind: "session"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "unavailable"; message: string };

export type DraftSaveResult =
  | { ok: true; application: Record<string, unknown> & { id: string; reference: string; version: number }; replayed?: boolean }
  | { ok: false; failure: DraftSaveFailure; replayed?: boolean };

// The idempotency key helpers live in the screen kit; re-exported so existing imports keep working.
export { newIdempotencyKey, PayloadKeyGate as DraftIdempotencyGate } from "@/lib/client/runtimeHttp";

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string") {
    return (body as { message: string }).message;
  }
  return fallback;
}

async function draftWrite(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
  idempotencyKey: string,
): Promise<DraftSaveResult> {
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return { ok: false, failure: { kind: "validation", message: "An Idempotency-Key header is required for this request." } };
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, failure: { kind: "unavailable", message: READ_UI_MESSAGES.api_unreachable } };
  }
  const replayed = res.headers.get("Idempotency-Replayed") === "true";
  const parsed = await res.json().catch(() => null);
  if (res.ok && parsed && typeof parsed === "object" && "id" in parsed && "reference" in parsed) {
    return {
      ok: true,
      application: parsed as Record<string, unknown> & { id: string; reference: string; version: number },
      replayed,
    };
  }
  const code = parsed && typeof parsed === "object" && "error" in parsed ? String((parsed as { error: unknown }).error) : "";
  if (res.status === 401) return { ok: false, failure: { kind: "session", message: messageFrom(parsed, READ_UI_MESSAGES.no_session) } };
  if (res.status === 403) return { ok: false, failure: { kind: "denied", message: messageFrom(parsed, "This request is not permitted.") } };
  if (res.status === 409) return { ok: false, failure: { kind: "conflict", message: messageFrom(parsed, "The record has changed since it was loaded.") } };
  if (res.status === 422) return { ok: false, failure: { kind: "validation", message: messageFrom(parsed, "The request could not be accepted.") } };
  return { ok: false, failure: { kind: "unavailable", message: messageFrom(parsed, READ_UI_MESSAGES.api_error) } };
}

export function createModelApplicationDraft(body: { brandId: string; category: string; modelNumber: string }, idempotencyKey: string) {
  return draftWrite("/api/runtime/model-applications", "POST", body, idempotencyKey);
}

export function patchModelApplicationDraft(
  id: string,
  body: { version: number; category: string; modelNumber: string; brandId?: string },
  idempotencyKey: string,
) {
  return draftWrite(`/api/runtime/model-applications/${encodeURIComponent(id)}`, "PATCH", body, idempotencyKey);
}

export function modelDraftFormHref(editId?: string | null): string {
  if (!editId) return "/app/model-label/new-model-application";
  return `/app/model-label/new-model-application?edit=${encodeURIComponent(editId)}`;
}
