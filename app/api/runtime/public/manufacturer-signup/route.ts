import { type NextRequest, NextResponse } from "next/server";
import { AUTH } from "@/lib/server/authConfig";
import { callBeeApi } from "@/lib/server/beeApi";
import { fromUpstream, isErrorCode } from "@/lib/server/apiContract";
import { SPRING_PUBLIC_MANUFACTURER_SIGNUP } from "@/lib/server/contracts/manufacturer-signup";
import { correlationIdOf, errorResponse, logged, setOutcome, withContractHeaders } from "@/lib/server/http";
import { createGuestIdentity, deleteGuestIdentity } from "@/lib/server/keycloakAdmin";
import { KeycloakError, passwordGrant, signingKeys } from "@/lib/server/keycloak";
import { authMethods, verifyIdToken } from "@/lib/server/oidc";
import { RateLimiter } from "@/lib/server/rateLimit";
import { createSession, destroySession, sessionCookieOf, setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const PER_ADDRESS = new RateLimiter(8);
const ALL = new RateLimiter(40);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE = /^[6-9]\d{9}$/;
const IDEMPOTENCY = /^[A-Za-z0-9-]{16,64}$/;

function json(body: object, status: number, correlationId: string) {
  return withContractHeaders(NextResponse.json(body, { status }), correlationId);
}

export const POST = logged("/api/runtime/public/manufacturer-signup", async (request: NextRequest) => {
  const correlationId = correlationIdOf(request);
  const person = PER_ADDRESS.check("signup");
  const everyone = ALL.check("all");
  if (!person.allowed || !everyone.allowed) {
    const res = json({ error: "rate_limited", message: "Too many requests. Wait a moment and try again." }, 429, correlationId);
    res.headers.set("Retry-After", String(Math.max(person.retryAfter, everyone.retryAfter)));
    return setOutcome(res, "rate_limited");
  }
  const key = request.headers.get("Idempotency-Key");
  if (!key || !IDEMPOTENCY.test(key)) {
    return errorResponse("idempotency_key_required", 422, correlationId);
  }
  let body: { fullName?: unknown; email?: unknown; mobile?: unknown; username?: unknown; password?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return errorResponse("validation_failed", 422, correlationId);
  }
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const mobile = typeof body.mobile === "string" ? body.mobile.trim() : "";
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (fullName.length < 2 || !EMAIL.test(email) || !MOBILE.test(mobile) || !/^[a-z0-9._-]{3,64}$/.test(username) || password.length < 8 || password.length > 200) {
    return errorResponse("validation_failed", 422, correlationId);
  }

  let guest: { ok: true; id: string } | { ok: false; conflict: boolean };
  try {
    guest = await createGuestIdentity({ username, email, fullName, password });
  } catch {
    return errorResponse("identity_unavailable", 503, correlationId);
  }
  if (!guest.ok) {
    return errorResponse("registration_not_available", 409, correlationId);
  }

  const springBody = JSON.stringify({
    fullName,
    email,
    mobile,
    keycloakSubject: guest.id,
  });
  const api = await callBeeApi("/api/public/manufacturer-signup", {
    correlationId,
    method: "POST",
    body: springBody,
    extraHeaders: { "Idempotency-Key": key },
  });
  const out = fromUpstream(api.status, api.body, SPRING_PUBLIC_MANUFACTURER_SIGNUP);
  if (out.status >= 400) {
    await deleteGuestIdentity(guest.id);
    const res = json(out.body as object, out.status, correlationId);
    if (out.status === 429) {
      res.headers.set("Retry-After", /^[0-9]{1,3}$/.test(api.forwardHeaders?.["Retry-After"] ?? "") ? api.forwardHeaders!["Retry-After"] : "60");
    }
    const error = (out.body as { error?: unknown } | null)?.error;
    return isErrorCode(error) ? setOutcome(res, error) : res;
  }

  const created = out.body as { username: string; applicationId: string };
  let tokens;
  try {
    tokens = await passwordGrant(username, password, correlationId);
  } catch (e) {
    const wrong = e instanceof KeycloakError && e.code === "invalid_grant";
    return json(
      { error: wrong ? "registration_not_available" : "identity_unavailable", message: wrong ? "The request could not be completed." : "The identity service is not reachable. Try again later." },
      wrong ? 409 : 503,
      correlationId,
    );
  }
  try {
    if (!tokens.id_token) throw new Error("no id token");
    const kid = JSON.parse(Buffer.from(tokens.id_token.split(".")[0], "base64url").toString("utf8")).kid as string | undefined;
    const claims = verifyIdToken(tokens.id_token, { issuer: AUTH.issuer, clientId: AUTH.clientId, jwks: await signingKeys(kid, correlationId) });
    destroySession(sessionCookieOf(request));
    const { cookie } = createSession(claims.sub, claims.preferred_username ?? claims.sub, tokens, authMethods(claims));
    const res = json(
      {
        ok: true,
        applicationId: created.applicationId,
        returnTo: "/app/manufacturer/onboarding",
        verification: "simulated",
      },
      201,
      correlationId,
    );
    setSessionCookie(res, cookie);
    return setOutcome(res, "ok");
  } catch {
    return json(
      { ok: true, applicationId: created.applicationId, returnTo: "/login", verification: "simulated" },
      201,
      correlationId,
    );
  }
});

export const GET = logged("/api/runtime/public/manufacturer-signup", (request: NextRequest) =>
  errorResponse("method_not_allowed", 405, correlationIdOf(request)));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
