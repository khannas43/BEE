import "server-only";
import { AUTH } from "./authConfig";
import type { Jwk } from "./oidc";

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

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new KeycloakError("metadata_unavailable", res.status);
  return (await res.json()) as T;
}

export async function oidcMetadata(): Promise<Discovery> {
  if (discovery && Date.now() - discovery.at < CACHE_MS) return discovery.value;
  const value = await getJson<Discovery>(`${AUTH.issuer}/.well-known/openid-configuration`);
  if (value.issuer !== AUTH.issuer) throw new KeycloakError("issuer_mismatch", 500);
  discovery = { value, at: Date.now() };
  return value;
}

/** Signing keys, refetched once when a token names an unknown key id. */
export async function signingKeys(kid?: string): Promise<Jwk[]> {
  const fresh = !jwks || Date.now() - jwks.at > CACHE_MS || (kid !== undefined && !jwks.keys.some((k) => k.kid === kid));
  if (fresh) jwks = { keys: (await getJson<{ keys: Jwk[] }>((await oidcMetadata()).jwks_uri)).keys, at: Date.now() };
  return jwks!.keys;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  const { token_endpoint } = await oidcMetadata();
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: AUTH.clientId, client_secret: AUTH.clientSecret, ...params }),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<TokenSet> & { error?: string };
  if (!res.ok || !body.access_token || !body.refresh_token) throw new KeycloakError(body.error ?? "token_request_failed", res.status);
  return body as TokenSet;
}

export const exchangeCode = (code: string, codeVerifier: string) =>
  tokenRequest({ grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: AUTH.redirectUri });

export const refreshTokens = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

/** Back-channel logout: ends the Keycloak user session behind this refresh token. */
export async function endKeycloakSession(refreshToken: string): Promise<boolean> {
  try {
    const { end_session_endpoint } = await oidcMetadata();
    const res = await fetch(end_session_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: AUTH.clientId, client_secret: AUTH.clientSecret, refresh_token: refreshToken }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
