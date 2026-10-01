/**
 * Browser-facing reads over Spring (WP03.2). The browser presents only its session
 * cookie; the access token stays in the server session, the browser's own
 * Authorization header is never forwarded, and Spring alone decides scope.
 */
import "server-only";
import { fromUpstream, isErrorCode, type UpstreamErrors, type Validator } from "@/lib/server/apiContract";
import { callBeeApi } from "@/lib/server/beeApi";
import { correlationIdOf, errorResponse, jsonResponse, setOutcome } from "@/lib/server/http";
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
