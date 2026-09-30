import { callBeeApi } from "@/lib/server/beeApi";

export const dynamic = "force-dynamic";

/**
 * Forwards to Spring's GET /api/me from the server. There is no sign-in flow yet
 * (WP02.1), so no token is attached and Spring answers 401; the browser's own
 * Authorization header is never forwarded.
 */
export async function GET() {
  const api = await callBeeApi("/api/me");
  return Response.json(api.body, { status: api.status, headers: { "X-Correlation-Id": api.correlationId, "Cache-Control": "no-store" } });
}
