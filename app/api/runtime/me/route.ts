import { type NextRequest } from "next/server";
import { SPRING_ME } from "@/lib/server/apiContract";
import { sessionRead } from "@/lib/server/bff";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Calls Spring's GET /api/me with the access token held in this browser's server
 * session, refreshing it if it is about to expire. The browser's own
 * Authorization header is never forwarded, and Spring alone decides access.
 */
export const GET = logged("/api/runtime/me", async (request: NextRequest) => {
  return sessionRead(request, "/api/me", SPRING_ME);
});

export const POST = logged("/api/runtime/me", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
