import "server-only";
import { AUTH } from "./authConfig";
import type { Jwk } from "./oidc";
import { identityOutcome, writeLogLine, type IdentityOperation, type IdentityOutcome } from "./requestLog";

const TIMEOUT_MS = 5000;

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
  refresh_expires_in: number;
}

export class KeycloakError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(`keycloak: ${code} (HTTP ${status})`);
    this.code = code;
    this.status = status;
  }
}

let discovery: { value: Discovery; at: number } | null = null;
let jwks: { keys: Jwk[]; at: number } | null = null;
const CACHE_MS = 5 * 60_000;

/**
 * Every Keycloak call is logged in the portal's request log under the caller's correlation
 * ID, with the operation, HTTP status and a fixed outcome. Keycloak is not sent the ID and
 * does not record it; nothing from the request or response body is logged.
 */
async function identityCall(operation: IdentityOperation, correlationId: string, url: string, init: RequestInit = {}) {
  const start = Date.now();
  const log = (status: number, outcome: IdentityOutcome) =>
    writeLogLine({ event: "identity", correlationId, operation, status, outcome, durationMs: Date.now() - start });
  let res: Response;
  try {
    res = await fetch(AUTH.reachable(url), { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    log(0, "unreachable");
    throw err;
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  log(res.status, identityOutcome(res.ok, body.error));
  return { res, body };
}

async function getJson<T>(operation: "discovery" | "jwks", url: string, correlationId: string): Promise<T> {
  const { res, body } = await identityCall(operation, correlationId, url);
  if (!res.ok) throw new KeycloakError("metadata_unavailable", res.status);
  return body as T;
}

export async function oidcMetadata(correlationId: string): Promise<Discovery> {
  if (discovery && Date.now() - discovery.at < CACHE_MS) return discovery.value;
  const value = await getJson<Discovery>("discovery", `${AUTH.issuer}/.well-known/openid-configuration`, correlationId);
  if (value.issuer !== AUTH.issuer) throw new KeycloakError("issuer_mismatch", 500);
  discovery = { value, at: Date.now() };
  return value;
}

/** Signing keys, refetched once when a token names an unknown key id. */
export async function signingKeys(kid: string | undefined, correlationId: string): Promise<Jwk[]> {
  const fresh = !jwks || Date.now() - jwks.at > CACHE_MS || (kid !== undefined && !jwks.keys.some((k) => k.kid === kid));
  if (fresh) jwks = { keys: (await getJson<{ keys: Jwk[] }>("jwks", (await oidcMetadata(correlationId)).jwks_uri, correlationId)).keys, at: Date.now() };
  return jwks!.keys;
}

async function tokenRequest(operation: "token.code" | "token.refresh", params: Record<string, string>, correlationId: string): Promise<TokenSet> {
  const { token_endpoint } = await oidcMetadata(correlationId);
  const { res, body } = await identityCall(operation, correlationId, token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: AUTH.clientId, client_secret: AUTH.clientSecret, ...params }),
  });
  const t = body as Partial<TokenSet> & { error?: string };
  if (!res.ok || !t.access_token || !t.refresh_token) throw new KeycloakError(typeof t.error === "string" ? t.error : "token_request_failed", res.status);
  return t as TokenSet;
}

export const exchangeCode = (code: string, codeVerifier: string, correlationId: string) =>
  tokenRequest("token.code", { grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: AUTH.redirectUri }, correlationId);

export const refreshTokens = (refreshToken: string, correlationId: string) =>
  tokenRequest("token.refresh", { grant_type: "refresh_token", refresh_token: refreshToken }, correlationId);

/** Back-channel logout: ends the Keycloak user session behind this refresh token. */
export async function endKeycloakSession(refreshToken: string, correlationId: string): Promise<boolean> {
  try {
    const { end_session_endpoint } = await oidcMetadata(correlationId);
    const { res } = await identityCall("logout", correlationId, end_session_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: AUTH.clientId, client_secret: AUTH.clientSecret, refresh_token: refreshToken }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
