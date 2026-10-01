/**
 * Browser reads of model applications through the Next.js BFF (WP05.1a).
 * Spring alone decides scope; this module never filters by organisation or role.
 * The browser sends only the httpOnly session cookie — never an Authorization header.
 */

export const MODEL_STATES = [
  "draft",
  "fee_due",
  "iame_scrutiny",
  "bee_scrutiny",
  "rating",
  "director_review",
  "secretary_approval",
  "approved",
  "returned",
  "rejected",
] as const;

export type ModelState = (typeof MODEL_STATES)[number];

export interface ModelApplication {
  id: string;
  reference: string;
  organisation: string;
  brandName: string;
  category: string;
  modelNumber: string;
  state: ModelState;
  version: number;
  readBasis: string[];
  brandId?: string;
  principalOrganisation?: string;
}

export interface ModelApplicationList {
  items: ModelApplication[];
  count: number;
  authority: "spring-database";
}

/** Fixed client-safe messages (same strings as the BFF contract). */
export const READ_UI_MESSAGES = {
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
  empty_list: "No model applications are available to you.",
  loading: "Loading model applications…",
  loading_detail: "Loading application…",
} as const;

export type SessionDenial = "no_session" | "session_expired" | "unauthenticated";
export type ForbiddenDenial = "no_read_scope" | "mfa_required" | "no_active_account" | "no_effective_role";

export type ReadFailure =
  | { kind: "session"; code: SessionDenial; message: string }
  | { kind: "forbidden"; code: ForbiddenDenial; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "unavailable"; message: string };

export type ListRead =
  | { ok: true; list: ModelApplicationList }
  | { ok: false; failure: ReadFailure };

export type DetailRead =
  | { ok: true; application: ModelApplication }
  | { ok: false; failure: ReadFailure };

const LIST_PATH = "/api/runtime/model-applications";
const detailPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}`;

const SESSION_CODES = new Set<string>(["no_session", "session_expired", "unauthenticated"]);
const FORBIDDEN_CODES = new Set<string>(["no_read_scope", "mfa_required", "no_active_account", "no_effective_role"]);

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Options the browser must use: cookie credentials only, no bearer, no cache. */
export function runtimeReadInit(extraHeaders?: HeadersInit): RequestInit {
  const headers = new Headers(extraHeaders);
  headers.delete("authorization");
  headers.delete("Authorization");
  return { method: "GET", credentials: "include", cache: "no-store", headers };
}

function messageFor(code: string, fallback: string): string {
  return (READ_UI_MESSAGES as Record<string, string>)[code] ?? fallback;
}

function failureFrom(status: number, body: unknown): ReadFailure {
  const code = typeof body === "object" && body && "error" in body && typeof (body as { error: unknown }).error === "string"
    ? (body as { error: string }).error
    : "";
  if (status === 401 || SESSION_CODES.has(code)) {
    const sessionCode = (SESSION_CODES.has(code) ? code : "no_session") as SessionDenial;
    return { kind: "session", code: sessionCode, message: messageFor(sessionCode, READ_UI_MESSAGES.no_session) };
  }
  if (status === 403 || FORBIDDEN_CODES.has(code)) {
    const forbidden = (FORBIDDEN_CODES.has(code) ? code : "no_read_scope") as ForbiddenDenial;
    return { kind: "forbidden", code: forbidden, message: messageFor(forbidden, READ_UI_MESSAGES.no_read_scope) };
  }
  if (status === 404) {
    // Same copy for unknown, cross-organisation and malformed IDs — never say which.
    return { kind: "not_found", message: READ_UI_MESSAGES.not_found };
  }
  if (status === 503) {
    return { kind: "unavailable", message: messageFor(code || "api_unreachable", READ_UI_MESSAGES.api_unreachable) };
  }
  return { kind: "unavailable", message: messageFor(code || "api_error", READ_UI_MESSAGES.api_error) };
}

/** A request that never reached the BFF (network failure, portal down) reads as unreachable, not as endless loading. */
async function send(fetchImpl: FetchLike, path: string): Promise<Response | null> {
  try {
    return await fetchImpl(path, runtimeReadInit());
  } catch {
    return null;
  }
}

const UNREACHABLE: ReadFailure = { kind: "unavailable", message: READ_UI_MESSAGES.api_unreachable };

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function asList(body: unknown): ModelApplicationList | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.authority !== "spring-database" || !Array.isArray(b.items) || typeof b.count !== "number") return null;
  return body as ModelApplicationList;
}

function asApplication(body: unknown): ModelApplication | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || typeof b.reference !== "string") return null;
  return body as ModelApplication;
}

/** GET /api/runtime/model-applications — scope is whatever Spring returned. */
export async function readModelApplicationList(fetchImpl: FetchLike = fetch): Promise<ListRead> {
  const res = await send(fetchImpl, LIST_PATH);
  if (!res) return { ok: false, failure: UNREACHABLE };
  const body = await parseJson(res);
  if (res.ok) {
    const list = asList(body);
    if (!list) return { ok: false, failure: { kind: "unavailable", message: READ_UI_MESSAGES.invalid_api_response } };
    return { ok: true, list };
  }
  return { ok: false, failure: failureFrom(res.status, body) };
}

/**
 * GET /api/runtime/model-applications/{id}.
 * Out-of-scope and unknown IDs share one not_found failure; the UI must not distinguish them.
 */
export async function readModelApplication(id: string, fetchImpl: FetchLike = fetch): Promise<DetailRead> {
  const res = await send(fetchImpl, detailPath(id));
  if (!res) return { ok: false, failure: UNREACHABLE };
  const body = await parseJson(res);
  if (res.ok) {
    const application = asApplication(body);
    if (!application) return { ok: false, failure: { kind: "unavailable", message: READ_UI_MESSAGES.invalid_api_response } };
    return { ok: true, application };
  }
  return { ok: false, failure: failureFrom(res.status, body) };
}

/** Build the same-route detail URL; selection is a query parameter only. */
export function modelDashboardHref(id?: string | null): string {
  if (!id) return "/app/model-label/model-dashboard";
  return `/app/model-label/model-dashboard?id=${encodeURIComponent(id)}`;
}

export function stateLabel(state: string): string {
  return state.replaceAll("_", " ");
}
