import { type NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/server/authConfig";
import { correlationIdOf, logged, methodNotAllowed, setOutcome, withContractHeaders } from "@/lib/server/http";
import { oidcMetadata } from "@/lib/server/keycloak";
import { authorizeUrl, pkceChallenge, safeReturnTo } from "@/lib/server/oidc";
import { beginLogin, setLoginCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Starts the Keycloak authorization-code flow with PKCE, state and nonce. */
export const GET = logged("/api/auth/login", async (request: NextRequest) => {
  const correlationId = correlationIdOf(request);
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  let endpoint: string;
  try {
    endpoint = (await oidcMetadata(correlationId)).authorization_endpoint;
  } catch {
    return setOutcome(withContractHeaders(NextResponse.redirect(new URL("/login?error=identity_unavailable", AUTH.webOrigin), 303), correlationId), "identity_unavailable");
  }
  const { cookie, tx } = beginLogin(returnTo);
  const res = NextResponse.redirect(
    authorizeUrl({ authorizationEndpoint: endpoint, clientId: AUTH.clientId, redirectUri: AUTH.redirectUri, state: tx.state, nonce: tx.nonce, codeChallenge: pkceChallenge(tx.codeVerifier) }),
    303,
  );
  setLoginCookie(res, cookie);
  return withContractHeaders(res, correlationId);
});

export const POST = logged("/api/auth/login", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
