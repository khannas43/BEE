/**
 * Browser-facing reads over Spring (WP03.2). The browser presents only its session
 * cookie; the access token stays in the server session, the browser's own
 * Authorization header is never forwarded, and Spring alone decides scope.
 */
import "server-only";
import { fromUpstream, type UpstreamErrors, type Validator } from "@/lib/server/apiContract";
import { callBeeApi } from "@/lib/server/beeApi";
import { correlationIdOf, errorResponse, jsonResponse } from "@/lib/server/http";
import { activeSession, clearSessionCookie, sessionCookieOf } from "@/lib/server/session";
import type { NextRequest } from "next/server";

export async function sessionRead<T>(request: NextRequest, springPath: string, op: { errors: UpstreamErrors; validate: Validator<T> }) {
  const correlationId = correlationIdOf(request);
  const cookie = sessionCookieOf(request);
  const active = await activeSession(cookie);
  if (!active.ok) {
    const res = errorResponse(active.reason, active.reason === "identity_unavailable" ? 503 : 401, correlationId);
    if (cookie && active.reason !== "identity_unavailable") clearSessionCookie(res);
    return res;
  }
  const api = await callBeeApi(springPath, { correlationId, accessToken: active.session.accessToken });
  const out = fromUpstream(api.status, api.body, op);
  return jsonResponse(out.body, out.status, correlationId);
}
