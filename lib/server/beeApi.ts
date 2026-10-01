/**
 * Server-side client for the local Spring API (ADR-001 D-RT2). Import only from
 * route handlers or other server code: the browser never calls Spring directly
 * and never receives a token.
 */
import "server-only";
import { CORRELATION_HEADER, isErrorCode } from "@/lib/server/apiContract";
import { springRoute, writeLogLine } from "@/lib/server/requestLog";

const API_BASE = process.env.BEE_API_URL ?? "http://127.0.0.1:8090";
const TIMEOUT_MS = 3000;

export interface ApiResult {
  status: number;
  body: unknown;
  correlationId: string;
}

/**
 * The caller's correlation ID is sent to Spring and logged with the route template,
 * status and documented error code. The log line never includes the token, headers,
 * record ID or body.
 */
export async function callBeeApi(path: string, init: { correlationId: string; accessToken?: string }): Promise<ApiResult> {
  const { correlationId } = init;
  const headers: Record<string, string> = { Accept: "application/json", [CORRELATION_HEADER]: correlationId };
  if (init.accessToken) headers.Authorization = `Bearer ${init.accessToken}`;
  const start = Date.now();
  let result: ApiResult;
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: "invalid_api_response" };
    }
    result = { status: res.status, body, correlationId };
  } catch {
    result = { status: 503, body: { error: "api_unreachable" }, correlationId };
  }
  const error = (result.body as { error?: unknown } | null)?.error;
  writeLogLine({
    event: "upstream",
    correlationId,
    method: "GET",
    route: springRoute(path),
    status: result.status,
    outcome: isErrorCode(error) ? error : error === undefined && result.status < 400 ? "ok" : "unlisted",
    durationMs: Date.now() - start,
  });
  return result;
}
