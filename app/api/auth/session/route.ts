import { type NextRequest } from "next/server";
import { correlationIdOf, jsonResponse, logged, methodNotAllowed } from "@/lib/server/http";
import { publicView, readSession, sessionCookieOf } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Whether this browser has a server session. Never returns tokens. */
export const GET = logged("/api/auth/session", async (request: NextRequest) => {
  const session = readSession(sessionCookieOf(request));
  return jsonResponse(session ? publicView(session) : { authenticated: false }, 200, correlationIdOf(request));
});

export const POST = logged("/api/auth/session", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
