import { type NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/server/authConfig";
import { oidcMetadata } from "@/lib/server/keycloak";
import { authorizeUrl, pkceChallenge, safeReturnTo } from "@/lib/server/oidc";
import { beginLogin, setLoginCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Starts the Keycloak authorization-code flow with PKCE, state and nonce. */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  let endpoint: string;
  try {
    endpoint = (await oidcMetadata()).authorization_endpoint;
  } catch {
    return NextResponse.redirect(new URL("/login?error=identity_unavailable", AUTH.webOrigin), 303);
  }
  const { cookie, tx } = beginLogin(returnTo);
  const res = NextResponse.redirect(
    authorizeUrl({ authorizationEndpoint: endpoint, clientId: AUTH.clientId, redirectUri: AUTH.redirectUri, state: tx.state, nonce: tx.nonce, codeChallenge: pkceChallenge(tx.codeVerifier) }),
    303,
  );
  setLoginCookie(res, cookie);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
