import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { AUTH } from "./authConfig";
import { KeycloakError, refreshTokens, type TokenSet } from "./keycloak";
import { randomToken, sha256 } from "./oidc";

/**
 * Server-side session store (WP02.1). The browser holds only a random id in an
 * httpOnly cookie; access, refresh and ID tokens never leave this process.
 * Entries are keyed by the SHA-256 of the cookie value, so the store alone does
 * not yield usable cookies. In-memory: one Next.js process, lost on restart.
 */
export interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  expiresAt: number;
}

export interface ServerSession {
  subject: string;
  username: string;
  accessToken: string;
  accessExpiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
  idToken?: string;
  createdAt: number;
  expiresAt: number;
  refreshCount: number;
  /** Methods from the sign-in ID token's amr claim; the callback requires pwd and otp. */
  authMethods: string[];
}

interface Stores {
  logins: Map<string, LoginTransaction>;
  sessions: Map<string, ServerSession>;
  refreshing: Map<string, Promise<ServerSession | null>>;
}

// Survives dev-server module reloads; still one process only.
const g = globalThis as typeof globalThis & { __beeAuthStores?: Stores };
const stores: Stores = (g.__beeAuthStores ??= { logins: new Map(), sessions: new Map(), refreshing: new Map() });

// Expired sessions are kept briefly so a returning browser is told "session_expired".
const EXPIRED_GRACE_MS = 3600_000;
const endsAt = (s: ServerSession) => Math.min(s.expiresAt, s.refreshExpiresAt);

function sweep(now = Date.now()) {
  for (const [k, t] of stores.logins) if (t.expiresAt <= now) stores.logins.delete(k);
  for (const [k, s] of stores.sessions) if (endsAt(s) + EXPIRED_GRACE_MS <= now) stores.sessions.delete(k);
}

const cookieBase = () => ({ httpOnly: true, sameSite: "lax" as const, secure: AUTH.secureCookies });

/* ---------- login transactions (state, nonce, PKCE verifier) ---------- */

export function beginLogin(returnTo: string): { cookie: string; tx: LoginTransaction } {
  sweep();
  const cookie = randomToken();
  const tx: LoginTransaction = { state: randomToken(), nonce: randomToken(), codeVerifier: randomToken(48), returnTo, expiresAt: Date.now() + AUTH.loginTtlSeconds * 1000 };
  stores.logins.set(sha256(cookie), tx);
  return { cookie, tx };
}

/** One-time: the transaction is removed whether or not the callback succeeds. */
export function takeLogin(cookie: string | undefined): LoginTransaction | null {
  if (!cookie) return null;
  const key = sha256(cookie);
  const tx = stores.logins.get(key) ?? null;
  stores.logins.delete(key);
  return tx && tx.expiresAt > Date.now() ? tx : null;
}

export function setLoginCookie(res: NextResponse, value: string) {
  res.cookies.set(AUTH.loginCookie, value, { ...cookieBase(), path: "/api/auth/callback", maxAge: AUTH.loginTtlSeconds });
}

export function clearLoginCookie(res: NextResponse) {
  res.cookies.set(AUTH.loginCookie, "", { ...cookieBase(), path: "/api/auth/callback", maxAge: 0 });
}

/* ---------- sessions ---------- */

function fromTokens(t: TokenSet, now: number) {
  return {
    accessToken: t.access_token,
    accessExpiresAt: now + t.expires_in * 1000,
    refreshToken: t.refresh_token,
    refreshExpiresAt: t.refresh_expires_in > 0 ? now + t.refresh_expires_in * 1000 : Number.POSITIVE_INFINITY,
  };
}

export function createSession(subject: string, username: string, tokens: TokenSet, authMethods: string[]): { cookie: string; session: ServerSession } {
  sweep();
  const now = Date.now();
  const cookie = randomToken();
  const session: ServerSession = { subject, username, ...fromTokens(tokens, now), idToken: tokens.id_token, createdAt: now, expiresAt: now + AUTH.sessionMaxSeconds * 1000, refreshCount: 0, authMethods };
  stores.sessions.set(sha256(cookie), session);
  return { cookie, session };
}

export function setSessionCookie(res: NextResponse, value: string) {
  res.cookies.set(AUTH.sessionCookie, value, { ...cookieBase(), path: "/", maxAge: AUTH.sessionMaxSeconds });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(AUTH.sessionCookie, "", { ...cookieBase(), path: "/", maxAge: 0 });
}

export const sessionCookieOf = (req: NextRequest) => req.cookies.get(AUTH.sessionCookie)?.value;

/** The live session for this cookie, or null if unknown or past its end. */
export function readSession(cookie: string | undefined): ServerSession | null {
  if (!cookie) return null;
  sweep();
  const s = stores.sessions.get(sha256(cookie));
  return s && endsAt(s) > Date.now() ? s : null;
}

/** Removes the session and returns it, so the caller can end the Keycloak session too. */
export function destroySession(cookie: string | undefined): ServerSession | null {
  if (!cookie) return null;
  const key = sha256(cookie);
  const s = stores.sessions.get(key) ?? null;
  stores.sessions.delete(key);
  return s;
}

export type ActiveSession =
  | { ok: true; session: ServerSession }
  | { ok: false; reason: "no_session" | "session_expired" | "identity_unavailable" };

/**
 * Returns a session whose access token is valid for at least the refresh leeway,
 * refreshing it once if needed. A rejected refresh ends the session.
 */
export async function activeSession(cookie: string | undefined): Promise<ActiveSession> {
  if (!cookie) return { ok: false, reason: "no_session" };
  sweep();
  const session = stores.sessions.get(sha256(cookie));
  if (!session) return { ok: false, reason: "no_session" };
  const now = Date.now();
  if (endsAt(session) <= now) {
    destroySession(cookie);
    return { ok: false, reason: "session_expired" };
  }
  if (session.accessExpiresAt - now > AUTH.refreshLeewaySeconds * 1000) return { ok: true, session };
  const key = sha256(cookie!);
  let pending = stores.refreshing.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const t = await refreshTokens(session.refreshToken);
        Object.assign(session, fromTokens(t, Date.now()), { idToken: t.id_token ?? session.idToken, refreshCount: session.refreshCount + 1 });
        return session;
      } catch (err) {
        if (err instanceof KeycloakError && (err.code === "invalid_grant" || err.status === 400 || err.status === 401)) {
          destroySession(cookie);
          return null;
        }
        throw err;
      } finally {
        stores.refreshing.delete(key);
      }
    })();
    stores.refreshing.set(key, pending);
  }
  try {
    const refreshed = await pending;
    return refreshed ? { ok: true, session: refreshed } : { ok: false, reason: "session_expired" };
  } catch {
    return { ok: false, reason: "identity_unavailable" };
  }
}

/** Browser-safe view of a session: no tokens. */
export const publicView = (s: ServerSession) => ({
  authenticated: true as const,
  username: s.username,
  accessExpiresAt: new Date(s.accessExpiresAt).toISOString(),
  sessionExpiresAt: new Date(endsAt(s)).toISOString(),
  refreshCount: s.refreshCount,
  authMethods: s.authMethods,
});
