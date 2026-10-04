import { isErrorCode } from "@/lib/server/apiContract";
import { callBeeApi } from "@/lib/server/beeApi";
import { correlationIdOf, jsonResponse, logged, methodNotAllowed, setOutcome } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/health", async (request: Request) => {
  const correlationId = correlationIdOf(request);
  const api = await callBeeApi("/actuator/health", { correlationId });
  const apiStatus = api.status === 200 || api.status === 503 ? ((api.body as { status?: string } | null)?.status ?? "UNKNOWN") : "UNKNOWN";
  const up = api.status === 200 && apiStatus === "UP";
  const components = apiStatus === "UNKNOWN" ? null : ((api.body as { components?: unknown } | null)?.components ?? null);
  const res = jsonResponse({ web: "UP", api: apiStatus, apiHttpStatus: api.status, components }, up ? 200 : 503, correlationId);
  if (up) return res;
  const error = (api.body as { error?: unknown } | null)?.error;
  return setOutcome(res, isErrorCode(error) ? error : apiStatus === "DOWN" ? "api_down" : "api_unknown");
});

export const POST = logged("/api/runtime/health", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
