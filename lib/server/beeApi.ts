/**
 * Server-side client for the local Spring API (ADR-001 D-RT2). Import only from
 * route handlers or other server code: the browser never calls Spring directly
 * and never receives a token.
 */
const API_BASE = process.env.BEE_API_URL ?? "http://127.0.0.1:8090";
const TIMEOUT_MS = 3000;

export interface ApiResult {
  status: number;
  body: unknown;
  correlationId: string;
}

export async function callBeeApi(path: string, init: { correlationId?: string; accessToken?: string } = {}): Promise<ApiResult> {
  const correlationId = init.correlationId ?? crypto.randomUUID();
  const headers: Record<string, string> = { Accept: "application/json", "X-Correlation-Id": correlationId };
  if (init.accessToken) headers.Authorization = `Bearer ${init.accessToken}`;
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: "invalid_api_response" };
    }
    return { status: res.status, body, correlationId: res.headers.get("X-Correlation-Id") ?? correlationId };
  } catch {
    return { status: 502, body: { error: "api_unreachable" }, correlationId };
  }
}
