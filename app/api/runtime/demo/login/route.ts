import { type NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/server/authConfig";
import { callBeeApi } from "@/lib/server/beeApi";
import { callbackOutcome } from "@/lib/server/apiContract";
import { demoLoginEnabled } from "@/lib/server/demoLogin";
import { correlationIdOf, errorResponse, logged, setOutcome, withContractHeaders } from "@/lib/server/http";
import { passwordGrant, signingKeys } from "@/lib/server/keycloak";
import { authMethods, verifyIdToken } from "@/lib/server/oidc";
import { createSession, destroySession, sessionCookieOf, setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const json = (body: object, status: number, correlationId: string) => withContractHeaders(NextResponse.json(body, { status }), correlationId);

/** Whether the demonstration sign-in is on, so the login page knows which form to show. Reveals nothing else. */
export const GET = logged("/api/runtime/demo", async (request: NextRequest) => json({ enabled: demoLoginEnabled() }, 200, correlationIdOf(request)));

/**
 * Demonstration sign-in: username and password, no authenticator code. Keycloak still checks the password; the server session is created
 * only if Spring accepts the person (active account and role), exactly as for the normal sign-in. 404 unless BEE_DEMO_LOGIN=1.
 */
export const POST = logged("/api/runtime/demo", async (request: NextRequest) => {
  const correlationId = correlationIdOf(request);
  if (!demoLoginEnabled()) return errorResponse("not_found", 404, correlationId);
  let body: { username?: unknown; password?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_credentials" }, 400, correlationId);
  }
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!username || username.length > 80 || !password || password.length > 200) return json({ error: "invalid_credentials" }, 400, correlationId);

  let tokens;
  try {
    tokens = await passwordGrant(username, password, correlationId);
  } catch (e) {
    const status = (e as { status?: number }).status;
    return json({ error: status === 400 || status === 401 ? "invalid_credentials" : "identity_unavailable" }, status === 400 || status === 401 ? 401 : 503, correlationId);
  }
  let claims;
  try {
    if (!tokens.id_token) throw new Error("no id token");
    const kid = JSON.parse(Buffer.from(tokens.id_token.split(".")[0], "base64url").toString("utf8")).kid as string | undefined;
    claims = verifyIdToken(tokens.id_token, { issuer: AUTH.issuer, clientId: AUTH.clientId, jwks: await signingKeys(kid, correlationId) });
  } catch {
    return json({ error: "invalid_id_token" }, 502, correlationId);
  }
  const me = await callBeeApi("/api/me", { correlationId, accessToken: tokens.access_token });
  const outcome = callbackOutcome(me.status, me.body, claims.sub);
  if (!outcome.ok) return json({ error: outcome.code }, 403, correlationId);

  destroySession(sessionCookieOf(request));
  const { cookie } = createSession(claims.sub, claims.preferred_username ?? claims.sub, tokens, authMethods(claims));
  const res = json({ ok: true, returnTo: "/app" }, 200, correlationId);
  setSessionCookie(res, cookie);
  return setOutcome(res, "ok");
});

export const PUT = logged("/api/runtime/demo", async (request: NextRequest) => errorResponse("method_not_allowed", 405, correlationIdOf(request)));
export const PATCH = PUT;
export const DELETE = PUT;
