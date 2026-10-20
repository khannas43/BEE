import { type NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/server/authConfig";
import { callBeeApi } from "@/lib/server/beeApi";
import { callbackOutcome } from "@/lib/server/apiContract";
import { demoLoginEnabled } from "@/lib/server/demoLogin";
import { correlationIdOf, errorResponse, logged, setOutcome, withContractHeaders } from "@/lib/server/http";
import { KeycloakError, passwordGrant, signingKeys } from "@/lib/server/keycloak";
import { RateLimiter } from "@/lib/server/rateLimit";
import { authMethods, verifyIdToken } from "@/lib/server/oidc";
import { recordActivity } from "@/lib/server/activityTrail";
import { clientIpOf } from "@/lib/server/clientIp";
import { createSession, destroySession, sessionCookieOf, setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Where each role lands: a live screen that suits it, not the generic prototype dashboard. */
const LANDING: Record<string, string> = {
  manufacturer: "/app/manufacturer/onboarding",
  agency: "/app/model-label/model-dashboard",
  finance: "/app/finance/finance-queue",
  iame: "/app/model-label/iame-scrutiny",
  reviewer: "/app/model-label/bee-scrutiny",
  programme: "/app/demo/mis",
  officer: "/app/demo/executive",
  director: "/app/demo/executive",
  admin: "/app/demo/mis",
  auditor: "/app/demo/auditor",
  helpdesk: "/app/demo/ai",
};
/** Organisations still in company registration (no permittee yet); they land on the registration wizard, every other manufacturer on its own 360 profile. */
const REGISTRATION_ORG_CODES = ["VIRAA", "ONBOARD"]; // and the GUEST-nnnnn organisations created by a public registration
function manufacturerLanding(me: unknown): string {
  const orgs = (me as { organisations?: { code?: unknown }[] } | null)?.organisations;
  const codes = (Array.isArray(orgs) ? orgs : []).map((o) => o?.code).filter((c): c is string => typeof c === "string");
  if (codes.length === 0 || codes.every((c) => REGISTRATION_ORG_CODES.includes(c) || c.startsWith("GUEST-"))) return LANDING.manufacturer;
  return `/app/demo/manufacturer-360?m=${encodeURIComponent(codes[0])}`;
}
function landingFor(me: unknown): string {
  const roles = (me as { effectiveRoles?: { role?: unknown }[] } | null)?.effectiveRoles;
  if (Array.isArray(roles) && roles.some((r) => r?.role === "manufacturer")) return manufacturerLanding(me);
  for (const r of Array.isArray(roles) ? roles : []) if (typeof r?.role === "string" && LANDING[r.role]) return LANDING[r.role];
  return "/app";
}

/** Sign-in attempts per person and in all, per minute: the password is known to the room, so a guessing loop must not be free (BL-233). */
const PER_PERSON = new RateLimiter(10);
const ALL_PEOPLE = new RateLimiter(120);

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

  const person = PER_PERSON.check(`user:${username}`);
  const everyone = ALL_PEOPLE.check("all");
  if (!person.allowed || !everyone.allowed) {
    const res = json({ error: "rate_limited" }, 429, correlationId);
    res.headers.set("Retry-After", String(Math.max(person.retryAfter, everyone.retryAfter)));
    return res;
  }

  let tokens;
  try {
    tokens = await passwordGrant(username, password, correlationId);
  } catch (e) {
    // Only Keycloak's own "invalid_grant" is a wrong password; a disabled direct grant or a missing client is a set-up problem and must not look like one.
    const wrongPassword = e instanceof KeycloakError && e.code === "invalid_grant";
    return json({ error: wrongPassword ? "invalid_credentials" : "identity_unavailable" }, wrongPassword ? 401 : 503, correlationId);
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
  await recordActivity(tokens.access_token, clientIpOf(request.headers), "login", "Signed in");
  const res = json({ ok: true, returnTo: landingFor(me.body) }, 200, correlationId);
  setSessionCookie(res, cookie);
  return setOutcome(res, "ok");
});

export const PUT = logged("/api/runtime/demo", async (request: NextRequest) => errorResponse("method_not_allowed", 405, correlationIdOf(request)));
export const PATCH = PUT;
export const DELETE = PUT;
