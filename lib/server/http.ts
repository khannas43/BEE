/**
 * Response helpers for the browser-facing route handlers: every answer is no-store
 * and carries the request's correlation ID, and every /api route handler is wrapped in
 * `logged`, which writes one structured request line (lib/server/requestLog.ts).
 */
import "server-only";
import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, errorBody, type ErrorCode } from "@/lib/server/apiContract";
import { safeMethod, safeOutcome, writeLogLine, type WebRoute } from "@/lib/server/requestLog";

export const correlationIdOf = (request: Request): string => correlationIdFrom(request.headers.get(CORRELATION_HEADER));

/** The contract error or sign-in redirect code a response carries, for the request log. */
const outcomes = new WeakMap<Response, string>();
export const setOutcome = <T extends Response>(res: T, code: string): T => {
  outcomes.set(res, code);
  return res;
};

export function withContractHeaders<T extends Response>(res: T, correlationId: string): T {
  res.headers.set(CORRELATION_HEADER, correlationId);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const jsonResponse = (body: unknown, status: number, correlationId: string) =>
  withContractHeaders(NextResponse.json(body, { status }), correlationId);

export const errorResponse = (code: ErrorCode, status: number, correlationId: string) =>
  setOutcome(jsonResponse(errorBody(code), status, correlationId), code);

/** Explicit 405 in the contract body for methods a route does not support. */
export function methodNotAllowed(allow: string) {
  return (request: Request) => {
    const res = errorResponse("method_not_allowed", 405, correlationIdOf(request));
    res.headers.set("Allow", allow);
    return res;
  };
}

/** Wraps a route handler so its outcome is logged under the response's correlation ID. */
export function logged<R extends Request, A extends unknown[]>(route: WebRoute, handler: (request: R, ...rest: A) => Response | Promise<Response>) {
  return async (request: R, ...rest: A): Promise<Response> => {
    const start = Date.now();
    let res: Response | undefined;
    try {
      res = await handler(request, ...rest);
      return res;
    } finally {
      const status = res?.status ?? 500;
      const code = res ? outcomes.get(res) : "internal_error";
      writeLogLine({
        event: "request",
        correlationId: res?.headers.get(CORRELATION_HEADER) ?? correlationIdOf(request),
        method: safeMethod(request.method),
        route,
        status,
        outcome: code ? safeOutcome(code) : status >= 400 ? "unlisted" : "ok",
        durationMs: Date.now() - start,
      });
    }
  };
}
