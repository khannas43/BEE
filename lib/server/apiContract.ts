/**
 * The BEE local API contract at the Next.js boundary (WP03.1,
 * docs/wp03/bee-local-api.openapi.json). Pure: no framework imports, so
 * `node --test scripts/local/api-contract.test.mjs` can exercise it.
 */
import { randomUUID } from "node:crypto";

export const CONTRACT_VERSION = "0.1.0";
export const CORRELATION_HEADER = "X-Correlation-Id";

/** Same rule as Spring's CorrelationIdFilter. */
const SAFE_CORRELATION_ID = /^[A-Za-z0-9-]{1,64}$/;

export const acceptCorrelationId = (value: string | null | undefined): string | null =>
  value && SAFE_CORRELATION_ID.test(value) ? value : null;

/** A caller's safe ID is kept; anything else is replaced. Never an authorization input. */
export const correlationIdFrom = (value: string | null | undefined): string => acceptCorrelationId(value) ?? randomUUID();

/** Every error code either layer may return, with its fixed client-safe message. */
export const ERROR_MESSAGES = {
  // Spring (also passed through by the Next boundary)
  unauthenticated: "A valid access token is required.",
  denied_by_default: "This operation is not available.",
  mfa_required: "Sign-in must include a verified one-time code.",
  no_active_account: "There is no active BEE account for this identity.",
  no_effective_role: "There is no active BEE role for this identity.",
  no_read_scope: "This role has no read access to model applications.",
  not_found: "No such record is available to you.",
  service_unavailable: "The service is temporarily unavailable. Try again later.",
  internal_error: "The request could not be completed.",
  // Next.js boundary only
  no_session: "Sign in to continue.",
  session_expired: "Your session has ended. Sign in again.",
  identity_unavailable: "The identity service is not reachable. Try again later.",
  api_unreachable: "The BEE service is not reachable. Try again later.",
  invalid_api_response: "The BEE service returned an unexpected response.",
  api_error: "The BEE service could not complete the request.",
  cross_origin: "This request must come from the BEE portal.",
  method_not_allowed: "This method is not supported for this resource.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export interface ErrorBody {
  error: ErrorCode;
  message: string;
}

export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, value);

export const errorBody = (code: ErrorCode): ErrorBody => ({ error: code, message: ERROR_MESSAGES[code] });

/** The status and code pairs Spring is allowed to return; anything else is an upstream fault. */
const SPRING_ERRORS: Record<number, readonly ErrorCode[]> = {
  401: ["unauthenticated"],
  403: ["denied_by_default", "mfa_required", "no_active_account", "no_effective_role", "no_read_scope"],
  404: ["not_found"],
  503: ["service_unavailable"],
};

/**
 * Maps a Spring answer to the browser-facing answer. Successes pass through; known
 * denials keep their status and code with the contract message; anything outside the
 * contract (500, unknown code, unparseable body) becomes 502 so Spring internals
 * never reach the browser.
 */
export function fromUpstream(status: number, body: unknown): { status: number; body: unknown } {
  const code = (body as { error?: unknown } | null)?.error;
  if (code === "api_unreachable") return { status: 503, body: errorBody("api_unreachable") };
  if (code === "invalid_api_response") return { status: 502, body: errorBody("invalid_api_response") };
  if (status >= 200 && status < 300) return { status, body };
  if (isErrorCode(code) && SPRING_ERRORS[status]?.includes(code)) return { status, body: errorBody(code) };
  return { status: 502, body: errorBody("api_error") };
}
