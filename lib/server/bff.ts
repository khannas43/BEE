/**
 * Browser-facing reads over Spring (WP03.2). The browser presents only its session
 * cookie; the access token stays in the server session, the browser's own
 * Authorization header is never forwarded, and Spring alone decides scope.
 */
import "server-only";
import { fromUpstream, isErrorCode, type UpstreamErrors, type Validator } from "@/lib/server/apiContract";
import { callBeeApi, callBeeApiBinary } from "@/lib/server/beeApi";
import { readBoundedBody } from "@/lib/server/boundedBody";
import { correlationIdOf, errorResponse, jsonResponse, setOutcome, withContractHeaders } from "@/lib/server/http";
import { activeSession, clearSessionCookie, sessionCookieOf } from "@/lib/server/session";
import type { NextRequest } from "next/server";

const IDEMPOTENCY = /^[A-Za-z0-9-]{16,64}$/;

export async function sessionWrite<T>(
  request: NextRequest,
  method: "POST" | "PATCH",
  springPath: string,
  body: string,
  op: { errors: UpstreamErrors; validate: Validator<T> },
) {
  const correlationId = correlationIdOf(request);
  const cookie = sessionCookieOf(request);
  const key = request.headers.get("Idempotency-Key");
  if (!key || !IDEMPOTENCY.test(key)) {
    return setOutcome(errorResponse("idempotency_key_required", 422, correlationId), "idempotency_key_required");
  }
  const active = await activeSession(cookie, correlationId);
  if (!active.ok) {
    const res = errorResponse(active.reason, active.reason === "identity_unavailable" ? 503 : 401, correlationId);
    if (cookie && active.reason !== "identity_unavailable") clearSessionCookie(res);
    return res;
  }
  const api = await callBeeApi(springPath, {
    correlationId,
    accessToken: active.session.accessToken,
    method,
    body,
    extraHeaders: { "Idempotency-Key": key },
  });
  const out = fromUpstream(api.status, api.body, op);
  const res = jsonResponse(out.body, out.status, correlationId);
  if (api.forwardHeaders) {
    for (const [name, value] of Object.entries(api.forwardHeaders)) res.headers.set(name, value);
  }
  const error = (out.body as { error?: unknown } | null)?.error;
  return isErrorCode(error) ? setOutcome(res, error) : res;
}

export async function sessionRead<T>(request: NextRequest, springPath: string, op: { errors: UpstreamErrors; validate: Validator<T> }) {
  const correlationId = correlationIdOf(request);
  const cookie = sessionCookieOf(request);
  const active = await activeSession(cookie, correlationId);
  if (!active.ok) {
    const res = errorResponse(active.reason, active.reason === "identity_unavailable" ? 503 : 401, correlationId);
    if (cookie && active.reason !== "identity_unavailable") clearSessionCookie(res);
    return res;
  }
  const api = await callBeeApi(springPath, { correlationId, accessToken: active.session.accessToken });
  const out = fromUpstream(api.status, api.body, op);
  const res = jsonResponse(out.body, out.status, correlationId);
  const error = (out.body as { error?: unknown } | null)?.error;
  return isErrorCode(error) ? setOutcome(res, error) : res;
}

/**
 * A read that needs no sign-in (the public certificate verification, decision D8). No session is read and no token is sent: Spring's
 * public route reads one view and answers the same for an unknown and a malformed registration ID. Only the registration ID is
 * passed on, URL-encoded; nothing from the request's headers or cookies reaches Spring.
 */
export async function publicRead<T>(request: NextRequest, springPath: string, op: { errors: UpstreamErrors; validate: Validator<T> }) {
  const correlationId = correlationIdOf(request);
  const api = await callBeeApi(springPath, { correlationId });
  const out = fromUpstream(api.status, api.body, op);
  const res = jsonResponse(out.body, out.status, correlationId);
  const error = (out.body as { error?: unknown } | null)?.error;
  return isErrorCode(error) ? setOutcome(res, error) : res;
}

/** Largest multipart body Next.js buffers: Spring's 5 MiB default file limit plus form-field and boundary overhead. */
export const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;
const MULTIPART = /^multipart\/form-data;\s*boundary=\S+/i;
const UPLOAD_TIMEOUT_MS = 30_000;
const SAFE_DISPOSITION = /^attachment; filename="[A-Za-z0-9._ -]{1,180}"$/;

/**
 * A multipart upload forwarded as received: the body bytes and the exact Content-Type
 * (with its boundary) go to Spring, with the validated Idempotency-Key and the session's
 * token. Form data is never parsed or re-encoded here; Spring validates every part.
 */
export async function sessionWriteMultipart<T>(
  request: NextRequest,
  springPath: string,
  op: { errors: UpstreamErrors; validate: Validator<T>; successStatuses?: readonly number[] },
) {
  const correlationId = correlationIdOf(request);
  const cookie = sessionCookieOf(request);
  const key = request.headers.get("Idempotency-Key");
  if (!key || !IDEMPOTENCY.test(key)) {
    return setOutcome(errorResponse("idempotency_key_required", 422, correlationId), "idempotency_key_required");
  }
  const active = await activeSession(cookie, correlationId);
  if (!active.ok) {
    const res = errorResponse(active.reason, active.reason === "identity_unavailable" ? 503 : 401, correlationId);
    if (cookie && active.reason !== "identity_unavailable") clearSessionCookie(res);
    return res;
  }
  const contentType = request.headers.get("Content-Type") ?? "";
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (!MULTIPART.test(contentType) || declared > MAX_MULTIPART_BYTES) {
    return errorResponse("validation_failed", 422, correlationId);
  }
  // Content-Length can be absent or wrong, so the limit is enforced while reading, not only up front.
  let bytes: ArrayBuffer | null;
  try {
    bytes = await readBoundedBody(request, MAX_MULTIPART_BYTES);
  } catch {
    return errorResponse("validation_failed", 422, correlationId);
  }
  if (!bytes || bytes.byteLength === 0) {
    return errorResponse("validation_failed", 422, correlationId);
  }
  const api = await callBeeApi(springPath, {
    correlationId,
    accessToken: active.session.accessToken,
    method: "POST",
    body: bytes,
    contentType,
    extraHeaders: { "Idempotency-Key": key },
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
  const out = fromUpstream(api.status, api.body, op);
  const res = jsonResponse(out.body, out.status, correlationId);
  if (api.forwardHeaders) {
    for (const [name, value] of Object.entries(api.forwardHeaders)) res.headers.set(name, value);
  }
  const error = (out.body as { error?: unknown } | null)?.error;
  return isErrorCode(error) ? setOutcome(res, error) : res;
}

/**
 * A PDF read. A 200 passes only when Spring says application/pdf; the bytes are then
 * served as a no-store, nosniff attachment. Every other answer is a documented JSON error
 * mapped by fromUpstream, or a fixed 502.
 */
export async function sessionReadBinary(request: NextRequest, springPath: string, op: { errors: UpstreamErrors }) {
  const correlationId = correlationIdOf(request);
  const cookie = sessionCookieOf(request);
  const active = await activeSession(cookie, correlationId);
  if (!active.ok) {
    const res = errorResponse(active.reason, active.reason === "identity_unavailable" ? 503 : 401, correlationId);
    if (cookie && active.reason !== "identity_unavailable") clearSessionCookie(res);
    return res;
  }
  const api = await callBeeApiBinary(springPath, { correlationId, accessToken: active.session.accessToken, timeoutMs: UPLOAD_TIMEOUT_MS });
  if (api.status === 200) {
    if (api.contentType !== "application/pdf" || api.bodyBytes.byteLength === 0) {
      return errorResponse("invalid_api_response", 502, correlationId);
    }
    const disposition = api.forwardHeaders?.["Content-Disposition"];
    const res = withContractHeaders(new Response(api.bodyBytes, { status: 200 }), correlationId);
    res.headers.set("Content-Type", "application/pdf");
    res.headers.set("Content-Disposition", disposition && SAFE_DISPOSITION.test(disposition) ? disposition : 'attachment; filename="document.pdf"');
    res.headers.set("X-Content-Type-Options", "nosniff");
    return res;
  }
  const out = fromUpstream(api.status, api.body, { errors: op.errors, validate: () => null, successStatuses: [] });
  const res = jsonResponse(out.body, out.status, correlationId);
  const error = (out.body as { error?: unknown } | null)?.error;
  return isErrorCode(error) ? setOutcome(res, error) : res;
}
