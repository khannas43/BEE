import { callBeeApi } from "@/lib/server/beeApi";
import { correlationIdOf, jsonResponse, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = correlationIdOf(request);
  const api = await callBeeApi("/actuator/health", { correlationId });
  const apiStatus = api.status === 200 || api.status === 503 ? ((api.body as { status?: string } | null)?.status ?? "UNKNOWN") : "UNKNOWN";
  const up = api.status === 200 && apiStatus === "UP";
  const components = apiStatus === "UNKNOWN" ? null : ((api.body as { components?: unknown } | null)?.components ?? null);
  return jsonResponse({ web: "UP", api: apiStatus, apiHttpStatus: api.status, components }, up ? 200 : 503, correlationId);
}

export const POST = methodNotAllowed("GET");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
