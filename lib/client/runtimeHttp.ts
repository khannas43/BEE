/**
 * Screen kit transport (no React): how every runtime screen talks to the Next.js BFF.
 *
 * - The browser sends only the httpOnly session cookie, never an Authorization header.
 * - Spring alone decides scope. Nothing here filters by organisation or role.
 * - A request that never reaches the BFF reads as unreachable, never as endless loading.
 * - Out-of-scope, unknown and malformed identifiers share one `not_found` copy.
 *
 * Reads use `runtimeRead` (or a module's own function built on `readFailure`); writes use
 * `runtimeCommand`, which requires an Idempotency-Key and reports replays. `PayloadKeyGate`
 * keeps one key per payload so a lost-response retry replays instead of duplicating.
 */

/** Fixed client-safe messages (same strings as the BFF contract). */
export const RUNTIME_MESSAGES = {
  no_session: "Sign in to continue.",
  session_expired: "Your session has ended. Sign in again.",
  unauthenticated: "A valid access token is required.",
  no_read_scope: "This role has no read access to model applications.",
  mfa_required: "Sign-in must include a verified one-time code.",
  no_active_account: "There is no active BEE account for this identity.",
  no_effective_role: "There is no active BEE role for this identity.",
  not_found: "No such record is available to you.",
  service_unavailable: "The service is temporarily unavailable. Try again later.",
  identity_unavailable: "The identity service is not reachable. Try again later.",
  api_unreachable: "The BEE service is not reachable. Try again later.",
  invalid_api_response: "The BEE service returned an unexpected response.",
  api_error: "The BEE service could not complete the request.",
} as const;

export type SessionDenial = "no_session" | "session_expired" | "unauthenticated";
export type ForbiddenDenial = "no_read_scope" | "mfa_required" | "no_active_account" | "no_effective_role";

export type ReadFailure =
  | { kind: "session"; code: SessionDenial; message: string }
  | { kind: "forbidden"; code: ForbiddenDenial; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "unavailable"; message: string };

/** Anything a read returns: success (with whatever payload the module names) or a typed failure. */
export type ReadLike = { ok: true } | { ok: false; failure: ReadFailure };

/** The generic read result used by `runtimeRead`. Modules may keep their own named payload shape instead. */
export type Read<T> = { ok: true; value: T } | { ok: false; failure: ReadFailure };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const SESSION_CODES = new Set<string>(["no_session", "session_expired", "unauthenticated"]);
const FORBIDDEN_CODES = new Set<string>(["no_read_scope", "mfa_required", "no_active_account", "no_effective_role"]);

export const UNREACHABLE: ReadFailure = { kind: "unavailable", message: RUNTIME_MESSAGES.api_unreachable };
export const INVALID_RESPONSE: ReadFailure = { kind: "unavailable", message: RUNTIME_MESSAGES.invalid_api_response };

/** Options the browser must use: cookie credentials only, no bearer, no cache. */
export function runtimeReadInit(extraHeaders?: HeadersInit): RequestInit {
  const headers = new Headers(extraHeaders);
  headers.delete("authorization");
  headers.delete("Authorization");
  return { method: "GET", credentials: "include", cache: "no-store", headers };
}

export function errorCodeOf(body: unknown): string {
  return typeof body === "object" && body && "error" in body && typeof (body as { error: unknown }).error === "string"
    ? (body as { error: string }).error
    : "";
}

function messageFor(code: string, fallback: string): string {
  return (RUNTIME_MESSAGES as Record<string, string>)[code] ?? fallback;
}

/** Maps a BFF error response to the one failure the screens render. */
export function readFailure(status: number, body: unknown): ReadFailure {
  const code = errorCodeOf(body);
  if (status === 401 || SESSION_CODES.has(code)) {
    const sessionCode = (SESSION_CODES.has(code) ? code : "no_session") as SessionDenial;
    return { kind: "session", code: sessionCode, message: messageFor(sessionCode, RUNTIME_MESSAGES.no_session) };
  }
  if (status === 403 || FORBIDDEN_CODES.has(code)) {
    const forbidden = (FORBIDDEN_CODES.has(code) ? code : "no_read_scope") as ForbiddenDenial;
    return { kind: "forbidden", code: forbidden, message: messageFor(forbidden, RUNTIME_MESSAGES.no_read_scope) };
  }
  if (status === 404) {
    // Same copy for unknown, cross-organisation and malformed IDs — never say which.
    return { kind: "not_found", message: RUNTIME_MESSAGES.not_found };
  }
  if (status === 503) {
    return { kind: "unavailable", message: messageFor(code || "api_unreachable", RUNTIME_MESSAGES.api_unreachable) };
  }
  return { kind: "unavailable", message: messageFor(code || "api_error", RUNTIME_MESSAGES.api_error) };
}

export async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** GET a BFF path. `parse` returns the typed payload, or null when the body does not have the documented shape. */
export async function runtimeRead<T>(path: string, parse: (body: unknown) => T | null, fetchImpl: FetchLike = fetch): Promise<Read<T>> {
  let res: Response;
  try {
    res = await fetchImpl(path, runtimeReadInit());
  } catch {
    return { ok: false, failure: UNREACHABLE };
  }
  const body = await parseJson(res);
  if (res.ok) {
    const value = parse(body);
    return value === null ? { ok: false, failure: INVALID_RESPONSE } : { ok: true, value };
  }
  return { ok: false, failure: readFailure(res.status, body) };
}

/**
 * What the screen shows for a signed-out identity: nothing while the identity is loading, never records
 * unless Spring reports a signed-in identity, and a failure the read already produced wins over the generic one.
 */
export const SIGNED_OUT: { ok: false; failure: ReadFailure } = {
  ok: false,
  failure: { kind: "session", code: "no_session", message: RUNTIME_MESSAGES.no_session },
};

export function gateRead<R extends ReadLike>(identityStatus: "loading" | "signed-in" | "signed-out", read: R | null): R | null {
  if (identityStatus === "loading") return null;
  if (identityStatus === "signed-out") return (read && !read.ok ? read : SIGNED_OUT) as R;
  return read;
}

// ---- commands (writes) ----

export const IDEMPOTENCY_KEY = /^[A-Za-z0-9-]{16,64}$/;

export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

/** Reuse one key per payload until the caller clears it after a known outcome (lost-response retry). */
export class PayloadKeyGate {
  private slot: { payload: string; key: string } | null = null;

  keyFor(payload: unknown): string {
    const serialized = JSON.stringify(payload);
    if (!this.slot || this.slot.payload !== serialized) {
      this.slot = { payload: serialized, key: newIdempotencyKey() };
    }
    return this.slot.key;
  }

  clear() {
    this.slot = null;
  }
}

export type CommandFailure =
  | { kind: "session"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "conflict"; message: string; code: string }
  | { kind: "validation"; message: string; code: string }
  | { kind: "unavailable"; message: string };

export type CommandResult<T> =
  | { ok: true; value: T; replayed: boolean }
  | { ok: false; failure: CommandFailure; replayed: boolean };

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body && typeof (body as { message: unknown }).message === "string") {
    return (body as { message: string }).message;
  }
  return fallback;
}

export function commandFailure(status: number, body: unknown): CommandFailure {
  const code = errorCodeOf(body);
  if (status === 401) return { kind: "session", message: messageFrom(body, RUNTIME_MESSAGES.no_session) };
  if (status === 403) return { kind: "denied", message: messageFrom(body, "This request is not permitted.") };
  if (status === 404) return { kind: "not_found", message: RUNTIME_MESSAGES.not_found };
  if (status === 409) return { kind: "conflict", code, message: messageFrom(body, "The record has changed since it was loaded.") };
  if (status === 422) return { kind: "validation", code, message: messageFrom(body, "The request could not be accepted.") };
  return { kind: "unavailable", message: messageFrom(body, RUNTIME_MESSAGES.api_error) };
}

/**
 * POST or PATCH a command with the required Idempotency-Key. A JSON object is sent as JSON; FormData is sent as
 * multipart with the browser's own boundary. `parse` returns the typed payload or null for an unexpected shape.
 */
export async function runtimeCommand<T>(
  path: string,
  method: "POST" | "PATCH",
  payload: object | FormData,
  idempotencyKey: string,
  parse: (body: unknown) => T | null,
  fetchImpl: FetchLike = fetch,
): Promise<CommandResult<T>> {
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    return { ok: false, replayed: false, failure: { kind: "validation", code: "idempotency_key_required", message: "An Idempotency-Key header is required for this request." } };
  }
  const headers: Record<string, string> = { "Idempotency-Key": idempotencyKey };
  let body: BodyInit;
  if (payload instanceof FormData) {
    body = payload;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(payload);
  }
  let res: Response;
  try {
    res = await fetchImpl(path, { method, credentials: "include", cache: "no-store", headers, body });
  } catch {
    return { ok: false, replayed: false, failure: { kind: "unavailable", message: RUNTIME_MESSAGES.api_unreachable } };
  }
  const replayed = res.headers.get("Idempotency-Replayed") === "true";
  const parsed = await parseJson(res);
  if (res.ok) {
    const value = parse(parsed);
    return value === null
      ? { ok: false, replayed, failure: { kind: "unavailable", message: RUNTIME_MESSAGES.invalid_api_response } }
      : { ok: true, replayed, value };
  }
  return { ok: false, replayed, failure: commandFailure(res.status, parsed) };
}

/**
 * POST with no body and no Idempotency-Key (recorded exceptions in the OpenAPI artifact, for example marking a notification read).
 * Same failure handling as `runtimeCommand`; `replayed` is always false.
 */
export async function runtimeAction<T>(
  path: string,
  parse: (body: unknown) => T | null,
  fetchImpl: FetchLike = fetch,
): Promise<CommandResult<T>> {
  let res: Response;
  try {
    const headers = new Headers();
    headers.delete("authorization");
    headers.delete("Authorization");
    res = await fetchImpl(path, { method: "POST", credentials: "include", cache: "no-store", headers });
  } catch {
    return { ok: false, replayed: false, failure: { kind: "unavailable", message: RUNTIME_MESSAGES.api_unreachable } };
  }
  const parsed = await parseJson(res);
  if (res.ok) {
    const value = parse(parsed);
    return value === null
      ? { ok: false, replayed: false, failure: { kind: "unavailable", message: RUNTIME_MESSAGES.invalid_api_response } }
      : { ok: true, replayed: false, value };
  }
  return { ok: false, replayed: false, failure: commandFailure(res.status, parsed) };
}

// ---- what to do after a command ----

/**
 * Whether the next send of the same payload must reuse the idempotency key.
 * Reuse only when the outcome is unknown or still running: a network failure or 5xx may have committed on the server, and
 * `idempotency_in_progress` means the first request has not finished, so a replay returns its stored result instead of
 * repeating it. Success and every definite refusal start the next send as a new command.
 */
export function keepKeyAfter(result: CommandResult<unknown>): boolean {
  if (result.ok) return false;
  const f = result.failure;
  return f.kind === "unavailable" || (f.kind === "conflict" && f.code === "idempotency_in_progress");
}

export interface FailureAdvice {
  /** Offer "try again": the same payload can be sent again. */
  retryable: boolean;
  /** Offer "reload": the record changed since it was read, so re-read it before editing again. */
  reload: boolean;
  /** Offer the sign-in link. */
  signIn: boolean;
}

export function commandAdvice(failure: CommandFailure): FailureAdvice {
  return {
    retryable: failure.kind === "unavailable" || (failure.kind === "conflict" && failure.code === "idempotency_in_progress"),
    reload: failure.kind === "conflict" && failure.code === "version_conflict",
    signIn: failure.kind === "session",
  };
}
