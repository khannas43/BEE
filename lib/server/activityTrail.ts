import "server-only";
import { demoLoginEnabled } from "@/lib/server/demoLogin";

/**
 * The sign-in and action trail (demonstration). Each sign-in and each successful write the portal makes for a person is sent to the API's
 * `/api/demo/activity` with the address the person came from; the API adds the person, role and organisation from the token. Never blocks or
 * fails the request it describes. Only when the demonstration sign-in is on.
 */
const API_BASE = process.env.BEE_API_URL ?? "http://127.0.0.1:8090";

const verbs: Record<string, string> = { POST: "Create", PUT: "Update", PATCH: "Update", DELETE: "Remove" };
const words = (s: string) => s.replace(/[-_]+/g, " ");

/** "POST /api/model-applications/{id}/submit" in words: "Submit (model applications)". */
export function describeWrite(method: string, path: string): string {
  const parts = path.split("?")[0].replace(/^\/api\/(demo\/)?/, "").split("/").filter((p) => p && !/^\{.*\}$/.test(p) && !/^[0-9a-f-]{8,}$/i.test(p));
  if (parts.length === 0) return `${verbs[method] ?? method} record`;
  const last = words(parts[parts.length - 1]);
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (parts.length === 1) return `${verbs[method] ?? method} ${last}`;
  return `${cap(last)} (${words(parts[parts.length - 2])})`;
}

export async function recordActivity(accessToken: string, ip: string, kind: "login" | "action", action: string): Promise<void> {
  if (!demoLoginEnabled()) return;
  try {
    await fetch(`${API_BASE}/api/demo/activity`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ kind, action, ip }),
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // the trail must never break the request it describes
  }
}
