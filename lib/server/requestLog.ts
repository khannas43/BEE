/**
 * Structured local request log for the Next.js server (WP03.3,
 * docs/wp03/request-log.schema.json). One JSON object per line in
 * $BEE_LOG_DIR/web-requests.jsonl, or on stdout when no log directory is set. Lines hold
 * only safe correlation IDs, enums, route templates, codes and numbers: never a raw path,
 * query string, header, cookie, token, authorization code, state, body or personal data.
 * Pure Node (no framework imports), so the unit tests can exercise it.
 */
import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export type WebRoute =
  | "/api/runtime/health"
  | "/api/runtime/me"
  | "/api/runtime/model-applications"
  | "/api/runtime/model-applications/{id}"
  | "/api/auth/session"
  | "/api/auth/login"
  | "/api/auth/callback"
  | "/api/auth/logout"
  | "/api/{unmatched}";

export type SpringRoute = "/actuator/health" | "/api/me" | "/api/model-applications" | "/api/model-applications/{id}";

export type IdentityOperation = "discovery" | "jwks" | "token.code" | "token.refresh" | "logout";

const OAUTH_ERRORS = ["invalid_grant", "invalid_client", "invalid_request", "unauthorized_client", "unsupported_grant_type", "invalid_scope"] as const;
export type IdentityOutcome = "ok" | (typeof OAUTH_ERRORS)[number] | "refused" | "unreachable";

export type LogLine =
  | { event: "request"; correlationId: string; method: string; route: WebRoute; status: number; outcome: string; durationMs: number }
  | { event: "upstream"; correlationId: string; method: "GET"; route: SpringRoute; status: number; outcome: string; durationMs: number }
  | { event: "identity"; correlationId: string; operation: IdentityOperation; status: number; outcome: IdentityOutcome; durationMs: number };

export const RETENTION = { file: "web-requests.jsonl", maxBytes: 5 * 1024 * 1024, maxRotatedFiles: 3, maxAgeDays: 7 } as const;

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const SAFE_OUTCOME = /^[a-z_]{2,40}$/;

export const safeMethod = (m: string): string => (METHODS.has(m) ? m : "OTHER");
export const safeOutcome = (code: unknown): string => (typeof code === "string" && SAFE_OUTCOME.test(code) ? code : "unlisted");

/** Spring path (as Next calls it) to its documented route template. */
export function springRoute(path: string): SpringRoute {
  const p = path.split("?")[0];
  if (p === "/api/me" || p === "/api/model-applications" || p === "/actuator/health") return p;
  return "/api/model-applications/{id}";
}

/** Keycloak's OAuth error code if it is a standard one, otherwise a fixed word. */
export function identityOutcome(ok: boolean, oauthError?: unknown): IdentityOutcome {
  if (ok) return "ok";
  return (OAUTH_ERRORS as readonly unknown[]).includes(oauthError) ? (oauthError as IdentityOutcome) : "refused";
}

/** Shifts web-requests.jsonl to .1, .1 to .2 ..., drops the oldest and anything past the age limit. */
export function rotate(dir: string, limits: { maxRotatedFiles: number; maxAgeDays: number } = RETENTION, now = Date.now()) {
  const base = join(dir, RETENTION.file);
  const nth = (i: number) => base.replace(/\.jsonl$/, `.${i}.jsonl`);
  try {
    unlinkSync(nth(limits.maxRotatedFiles));
  } catch {}
  for (let i = limits.maxRotatedFiles - 1; i >= 1; i--) {
    try {
      renameSync(nth(i), nth(i + 1));
    } catch {}
  }
  try {
    renameSync(base, nth(1));
  } catch {}
  prune(dir, limits, now);
}

export function prune(dir: string, limits: { maxRotatedFiles: number; maxAgeDays: number } = RETENTION, now = Date.now()) {
  const rotated = /^web-requests\.(\d+)\.jsonl$/;
  for (const name of readdirSync(dir)) {
    const m = rotated.exec(name);
    if (!m) continue;
    const f = join(dir, name);
    if (Number(m[1]) > limits.maxRotatedFiles || now - statSync(f).mtimeMs > limits.maxAgeDays * 86_400_000) unlinkSync(f);
  }
}

let pruned = false;

/** Appends one line; rotates first when the file would pass the size limit. */
export function writeLogLine(line: LogLine, dir = process.env.BEE_LOG_DIR, maxBytes: number = RETENTION.maxBytes) {
  const text = JSON.stringify({ ts: new Date().toISOString(), layer: "web", ...line }) + "\n";
  if (!dir) {
    process.stdout.write(text);
    return;
  }
  try {
    mkdirSync(dir, { recursive: true });
    if (!pruned) {
      prune(dir);
      pruned = true;
    }
    let size = 0;
    try {
      size = statSync(join(dir, RETENTION.file)).size;
    } catch {}
    if (size > 0 && size + text.length > maxBytes) rotate(dir);
    appendFileSync(join(dir, RETENTION.file), text);
  } catch {
    // Logging never fails a request.
  }
}
