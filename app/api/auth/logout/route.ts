import { type NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/server/authConfig";
import { correlationIdOf, errorResponse, jsonResponse, logged, methodNotAllowed, withContractHeaders } from "@/lib/server/http";
import { endKeycloakSession } from "@/lib/server/keycloak";
import { clearSessionCookie, destroySession, sessionCookieOf } from "@/lib/server/session";

export const dynamic = "force-dynamic";

function samePortalOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (origin === AUTH.webOrigin || origin === request.nextUrl.origin) return true;
  try {
    const supplied = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const requestHost = forwardedHost || request.headers.get("host");
    const requestProto = forwardedProto || request.nextUrl.protocol.replace(":", "");
    return Boolean(requestHost) && supplied.host === requestHost && supplied.protocol === `${requestProto}:`;
  } catch {
    return false;
  }
}

/**
 * Ends the server session and the Keycloak session behind it. POST only, and only
 * from the portal's own origin: other ports on 127.0.0.1 are same-site, so
 * SameSite=Lax alone would not stop them.
 */
export const POST = logged("/api/auth/logout", async (request: NextRequest) => {
  const correlationId = correlationIdOf(request);
  if (!samePortalOrigin(request)) return errorResponse("cross_origin", 403, correlationId);
  const session = destroySession(sessionCookieOf(request));
  const keycloakSessionEnded = session ? await endKeycloakSession(session.refreshToken, correlationId) : false;
  const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
  const res = wantsHtml
    ? withContractHeaders(NextResponse.redirect(new URL("/", request.headers.get("origin")!), 303), correlationId)
    : jsonResponse({ signedOut: true, hadSession: Boolean(session), keycloakSessionEnded }, 200, correlationId);
  clearSessionCookie(res);
  return res;
});

export const GET = logged("/api/auth/logout", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
