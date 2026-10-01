import { type NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/server/authConfig";
import { correlationIdOf, errorResponse, jsonResponse, logged, methodNotAllowed, withContractHeaders } from "@/lib/server/http";
import { endKeycloakSession } from "@/lib/server/keycloak";
import { clearSessionCookie, destroySession, sessionCookieOf } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Ends the server session and the Keycloak session behind it. POST only, and only
 * from the portal's own origin: other ports on 127.0.0.1 are same-site, so
 * SameSite=Lax alone would not stop them.
 */
export const POST = logged("/api/auth/logout", async (request: NextRequest) => {
  const correlationId = correlationIdOf(request);
  if (request.headers.get("origin") !== AUTH.webOrigin) return errorResponse("cross_origin", 403, correlationId);
  const session = destroySession(sessionCookieOf(request));
  const keycloakSessionEnded = session ? await endKeycloakSession(session.refreshToken, correlationId) : false;
  const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
  const res = wantsHtml
    ? withContractHeaders(NextResponse.redirect(new URL("/login?signedOut=1", AUTH.webOrigin), 303), correlationId)
    : jsonResponse({ signedOut: true, hadSession: Boolean(session), keycloakSessionEnded }, 200, correlationId);
  clearSessionCookie(res);
  return res;
});

export const GET = logged("/api/auth/logout", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
