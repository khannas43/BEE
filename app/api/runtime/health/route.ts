import { callBeeApi } from "@/lib/server/beeApi";

export const dynamic = "force-dynamic";

export async function GET() {
  const api = await callBeeApi("/actuator/health");
  const apiStatus = (api.body as { status?: string } | null)?.status ?? "UNKNOWN";
  const up = api.status === 200 && apiStatus === "UP";
  return Response.json(
    { web: "UP", api: apiStatus, apiHttpStatus: api.status, components: (api.body as { components?: unknown } | null)?.components ?? null },
    { status: up ? 200 : 503, headers: { "X-Correlation-Id": api.correlationId, "Cache-Control": "no-store" } },
  );
}
