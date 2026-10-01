import { type NextRequest } from "next/server";
import { fromUpstream, SPRING_ME } from "@/lib/server/apiContract";
import { callBeeApi } from "@/lib/server/beeApi";
import { correlationIdOf, errorResponse, jsonResponse, methodNotAllowed } from "@/lib/server/http";
import { activeSession, clearSessionCookie, sessionCookieOf } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Calls Spring's GET /api/me with the access token held in this browser's server
 * session, refreshing it if it is about to expire. The browser's own
 * Authorization header is never forwarded, and Spring alone decides access.
 */
export async function GET(request: NextRequest) {
  const correlationId = correlationIdOf(request);
  const cookie = sessionCookieOf(request);
  const active = await activeSession(cookie);
  if (!active.ok) {
    const res = errorResponse(active.reason, active.reason === "identity_unavailable" ? 503 : 401, correlationId);
    if (cookie && active.reason !== "identity_unavailable") clearSessionCookie(res);
    return res;
  }
  const api = await callBeeApi("/api/me", { correlationId, accessToken: active.session.accessToken });
  const out = fromUpstream(api.status, api.body, SPRING_ME);
  return jsonResponse(out.body, out.status, correlationId);
}

export const POST = methodNotAllowed("GET");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
