/**
 * Response helpers for the browser-facing route handlers: every answer is no-store
 * and carries the request's correlation ID.
 */
import "server-only";
import { NextResponse } from "next/server";
import { CORRELATION_HEADER, correlationIdFrom, errorBody, type ErrorCode } from "@/lib/server/apiContract";

export const correlationIdOf = (request: Request): string => correlationIdFrom(request.headers.get(CORRELATION_HEADER));

export function withContractHeaders<T extends Response>(res: T, correlationId: string): T {
  res.headers.set(CORRELATION_HEADER, correlationId);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const jsonResponse = (body: unknown, status: number, correlationId: string) =>
  withContractHeaders(NextResponse.json(body, { status }), correlationId);

export const errorResponse = (code: ErrorCode, status: number, correlationId: string) => jsonResponse(errorBody(code), status, correlationId);

/** Explicit 405 in the contract body for methods a route does not support. */
export function methodNotAllowed(allow: string) {
  return (request: Request) => {
    const res = errorResponse("method_not_allowed", 405, correlationIdOf(request));
    res.headers.set("Allow", allow);
    return res;
  };
}
