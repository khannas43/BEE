import { type NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/server/authConfig";
import { endKeycloakSession } from "@/lib/server/keycloak";
import { clearSessionCookie, destroySession, sessionCookieOf } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Ends the server session and the Keycloak session behind it. POST only, and only
 * from the portal's own origin: other ports on 127.0.0.1 are same-site, so
 * SameSite=Lax alone would not stop them.
 */
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== AUTH.webOrigin) {
    return NextResponse.json({ error: "cross_origin" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const session = destroySession(sessionCookieOf(request));
  const keycloakSessionEnded = session ? await endKeycloakSession(session.refreshToken) : false;
  const wantsHtml = (request.headers.get("accept") ?? "").includes("text/html");
  const res = wantsHtml
    ? NextResponse.redirect(new URL("/login?signedOut=1", AUTH.webOrigin), 303)
    : NextResponse.json({ signedOut: true, hadSession: Boolean(session), keycloakSessionEnded });
  clearSessionCookie(res);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
