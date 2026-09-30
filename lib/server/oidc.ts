/**
 * Pure OpenID Connect helpers for the Next.js server (WP02.1). No network and no
 * framework imports, so `node --test scripts/local/oidc.test.mjs` can exercise them.
 */
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey } from "node:crypto";

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("base64url");

/** RFC 7636 S256 code challenge. */
export const pkceChallenge = (verifier: string): string => sha256(verifier);

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Only same-origin relative paths; anything else falls back to the default. */
export function safeReturnTo(value: string | null | undefined, fallback = "/app"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

export interface AuthorizeParams {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}

export function authorizeUrl(p: AuthorizeParams): string {
  const url = new URL(p.authorizationEndpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: "openid",
    state: p.state,
    nonce: p.nonce,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

export interface IdTokenExpectations {
  issuer: string;
  clientId: string;
  nonce: string;
  jwks: Jwk[];
  nowSeconds?: number;
  clockSkewSeconds?: number;
}

export interface IdTokenClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  azp?: string;
  preferred_username?: string;
  name?: string;
  [claim: string]: unknown;
}

export class IdTokenError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`id_token rejected: ${reason}`);
    this.reason = reason;
  }
}

const decodePart = (part: string): Record<string, unknown> => {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new IdTokenError("malformed");
  }
};

/** Verifies an RS256 ID token's signature, issuer, audience, authorised party, lifetime and nonce. */
export function verifyIdToken(idToken: string, e: IdTokenExpectations): IdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new IdTokenError("malformed");
  const header = decodePart(parts[0]);
  if (header.alg !== "RS256") throw new IdTokenError(`unsupported alg ${String(header.alg)}`);
  const jwk = e.jwks.find((k) => k.kid === header.kid && k.kty === "RSA" && (k.use ?? "sig") === "sig");
  if (!jwk) throw new IdTokenError("unknown signing key");
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const signed = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"));
  if (!signed) throw new IdTokenError("bad signature");

  const c = decodePart(parts[1]) as unknown as IdTokenClaims;
  const now = e.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = e.clockSkewSeconds ?? 30;
  if (c.iss !== e.issuer) throw new IdTokenError("issuer mismatch");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(e.clientId)) throw new IdTokenError("audience mismatch");
  if (aud.length > 1 && c.azp !== e.clientId) throw new IdTokenError("authorised party mismatch");
  if (c.azp !== undefined && c.azp !== e.clientId) throw new IdTokenError("authorised party mismatch");
  if (typeof c.exp !== "number" || c.exp + skew < now) throw new IdTokenError("expired");
  if (typeof c.iat !== "number" || c.iat - skew > now) throw new IdTokenError("issued in the future");
  if (typeof c.nonce !== "string" || !safeEqual(c.nonce, e.nonce)) throw new IdTokenError("nonce mismatch");
  if (typeof c.sub !== "string" || !c.sub) throw new IdTokenError("missing subject");
  return c;
}
