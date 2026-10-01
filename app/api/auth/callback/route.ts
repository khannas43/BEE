import { type NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/server/authConfig";
import { callBeeApi } from "@/lib/server/beeApi";
import { correlationIdOf, methodNotAllowed, withContractHeaders } from "@/lib/server/http";
import { endKeycloakSession, exchangeCode, signingKeys, type TokenSet } from "@/lib/server/keycloak";
import { authMethods, IdTokenError, meetsMfaPolicy, safeEqual, verifyIdToken, type IdTokenClaims } from "@/lib/server/oidc";
import { clearLoginCookie, createSession, destroySession, sessionCookieOf, setSessionCookie, takeLogin } from "@/lib/server/session";

export const dynamic = "force-dynamic";

function failWith(correlationId: string, code: string) {
  const res = NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(code)}`, AUTH.webOrigin), 303);
  clearLoginCookie(res);
  return withContractHeaders(res, correlationId);
}

const kidOf = (jwt: string): string | undefined => {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString("utf8")).kid;
  } catch {
    return undefined;
  }
};

/**
 * Completes sign-in. Keycloak proves who the user is, with password and TOTP (the ID
 * token's amr must show both); the server session is created only if Spring, the
 * access authority, accepts the user (active account and an active role that the
 * token also carries).
 */
export async function GET(request: NextRequest) {
  const correlationId = correlationIdOf(request);
  const fail = (code: string) => failWith(correlationId, code);
  const q = request.nextUrl.searchParams;
  const tx = takeLogin(request.cookies.get(AUTH.loginCookie)?.value);
  if (!tx) return fail("login_expired");
  if (q.get("error")) return fail(q.get("error") === "access_denied" ? "access_denied" : "identity_error");
  const state = q.get("state");
  if (!state || !safeEqual(state, tx.state)) return fail("invalid_state");
  const iss = q.get("iss");
  if (iss !== null && iss !== AUTH.issuer) return fail("invalid_issuer");
  const code = q.get("code");
  if (!code) return fail("invalid_callback");

  let tokens: TokenSet;
  try {
    tokens = await exchangeCode(code, tx.codeVerifier);
  } catch {
    return fail("code_exchange_failed");
  }

  let claims: IdTokenClaims;
  try {
    if (!tokens.id_token) throw new IdTokenError("missing");
    claims = verifyIdToken(tokens.id_token, { issuer: AUTH.issuer, clientId: AUTH.clientId, nonce: tx.nonce, jwks: await signingKeys(kidOf(tokens.id_token)) });
  } catch {
    await endKeycloakSession(tokens.refresh_token);
    return fail("invalid_id_token");
  }
  if (!meetsMfaPolicy(claims)) {
    await endKeycloakSession(tokens.refresh_token);
    return fail("mfa_required");
  }
  const subject = claims.sub;
  const username = claims.preferred_username ?? claims.sub;

  const me = await callBeeApi("/api/me", { correlationId, accessToken: tokens.access_token });
  const body = me.body as { subject?: string; error?: string } | null;
  if (me.status !== 200 || body?.subject !== subject) {
    await endKeycloakSession(tokens.refresh_token);
    if (body?.error === "api_unreachable") return fail("api_unreachable");
    return fail(me.status === 200 ? "subject_mismatch" : (body?.error ?? "access_denied"));
  }

  destroySession(sessionCookieOf(request));
  const { cookie } = createSession(subject, username, tokens, authMethods(claims));
  const res = NextResponse.redirect(new URL(tx.returnTo, AUTH.webOrigin), 303);
  clearLoginCookie(res);
  setSessionCookie(res, cookie);
  return withContractHeaders(res, correlationId);
}

export const POST = methodNotAllowed("GET");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
