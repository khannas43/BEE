import { type NextRequest, NextResponse } from "next/server";
import { callBeeApi } from "@/lib/server/beeApi";
import { activeSession, clearSessionCookie, sessionCookieOf } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Calls Spring's GET /api/me with the access token held in this browser's server
 * session, refreshing it if it is about to expire. The browser's own
 * Authorization header is never forwarded, and Spring alone decides access.
 */
export async function GET(request: NextRequest) {
  const cookie = sessionCookieOf(request);
  const active = await activeSession(cookie);
  if (!active.ok) {
    const res = NextResponse.json({ error: active.reason }, { status: active.reason === "identity_unavailable" ? 503 : 401, headers: { "Cache-Control": "no-store" } });
    if (cookie && active.reason !== "identity_unavailable") clearSessionCookie(res);
    return res;
  }
  const api = await callBeeApi("/api/me", { accessToken: active.session.accessToken });
  return NextResponse.json(api.body, { status: api.status, headers: { "X-Correlation-Id": api.correlationId, "Cache-Control": "no-store" } });
}
