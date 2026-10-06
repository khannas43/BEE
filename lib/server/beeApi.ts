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
  /** Selected upstream response headers safe to forward to the browser. */
  forwardHeaders?: Record<string, string>;
}

/** A binary-mode answer: PDF bytes on success; a JSON error is parsed into `body` as in ApiResult. */
export interface BinaryApiResult {
  status: number;
  /** The raw upstream bytes when the answer is not JSON (e.g. application/pdf), otherwise empty. */
  bodyBytes: ArrayBuffer;
  /** Upstream media type without parameters, lower-cased; "" when absent. */
  contentType: string;
  /** Parsed JSON body when the answer is application/json (errors); null otherwise. */
  body: unknown;
  correlationId: string;
  forwardHeaders?: Record<string, string>;
}

export interface CallInit {
  correlationId: string;
  accessToken?: string;
  method?: string;
  /** A JSON string (Content-Type application/json unless `contentType` says otherwise) or raw bytes (needs `contentType`). */
  body?: string | ArrayBuffer;
  /** Sent as Content-Type when there is a body, verbatim (a multipart boundary must survive). */
  contentType?: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}

const FORWARD_REQUEST_HEADERS = ["Idempotency-Replayed", "Retry-After"] as const;
const FORWARD_BINARY_HEADERS = ["Idempotency-Replayed", "Content-Disposition"] as const;

function requestHeaders(init: CallInit, accept: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept, [CORRELATION_HEADER]: init.correlationId, ...init.extraHeaders };
  if (init.accessToken) headers.Authorization = `Bearer ${init.accessToken}`;
  if (init.body !== undefined) headers["Content-Type"] = init.contentType ?? "application/json";
  return headers;
}

function forwarded(res: Response, names: readonly string[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = res.headers.get(name);
    if (value) out[name] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function logUpstream(path: string, init: CallInit, status: number, body: unknown, start: number) {
  const error = (body as { error?: unknown } | null)?.error;
  writeLogLine({
    event: "upstream",
    correlationId: init.correlationId,
    method: init.method ?? "GET",
    route: springRoute(path),
    status,
    outcome: isErrorCode(error) ? error : error === undefined && status < 400 ? "ok" : "unlisted",
    durationMs: Date.now() - start,
  });
}

/**
 * The caller's correlation ID is sent to Spring and logged with the route template,
 * status and documented error code. The log line never includes the token, headers,
 * record ID or body.
 */
export async function callBeeApi(path: string, init: CallInit): Promise<ApiResult> {
  const { correlationId } = init;
  const start = Date.now();
  let result: ApiResult;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: requestHeaders(init, "application/json"),
      body: init.body,
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: "invalid_api_response" };
    }
    result = { status: res.status, body, correlationId, forwardHeaders: forwarded(res, FORWARD_REQUEST_HEADERS) };
  } catch {
    result = { status: 503, body: { error: "api_unreachable" }, correlationId };
  }
  logUpstream(path, init, result.status, result.body, start);
  return result;
}

/**
 * Like callBeeApi, but the answer may be binary. An application/json answer is parsed into
 * `body` (so documented errors map as usual); any other media type is returned as bytes.
 */
export async function callBeeApiBinary(path: string, init: CallInit & { accept?: string }): Promise<BinaryApiResult> {
  const { correlationId } = init;
  const start = Date.now();
  let result: BinaryApiResult;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: requestHeaders(init, init.accept ?? "application/pdf, application/json"),
      body: init.body,
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    });
    const contentType = (res.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
    const bytes = await res.arrayBuffer();
    let body: unknown = null;
    let bodyBytes = bytes;
    if (contentType === "application/json") {
      bodyBytes = new ArrayBuffer(0);
      const text = new TextDecoder().decode(bytes);
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = { error: "invalid_api_response" };
      }
    }
    result = { status: res.status, bodyBytes, contentType, body, correlationId, forwardHeaders: forwarded(res, FORWARD_BINARY_HEADERS) };
  } catch {
    result = { status: 503, bodyBytes: new ArrayBuffer(0), contentType: "", body: { error: "api_unreachable" }, correlationId };
  }
  logUpstream(path, init, result.status, result.body, start);
  return result;
}
