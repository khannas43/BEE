/**
 * Browser client for the demonstration areas (payments, QR, ledger, production, MIS, AI) behind /api/runtime/demo/**.
 * Local demonstration on the owner's assumptions, not BEE rules (BL-220: outside the documented contract). Spring decides who may do what;
 * a refusal comes back as a message the screen shows, preferring Spring's short detail.
 */
import { newIdempotencyKey, parseJson, RUNTIME_MESSAGES } from "@/lib/client/runtimeHttp";

export type DemoBody = Record<string, unknown> & { demonstration?: true };
export type DemoResult<T = DemoBody> = { ok: true; value: T } | { ok: false; status: number; code: string; message: string };

export const DEMO_PATH = "/api/runtime/demo";
export const demoPath = (...parts: (string | number)[]) => `${DEMO_PATH}/${parts.map((p) => encodeURIComponent(String(p))).join("/")}`;

async function call<T>(path: string, init: RequestInit): Promise<DemoResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "include", cache: "no-store", ...init });
  } catch {
    return { ok: false, status: 0, code: "api_unreachable", message: RUNTIME_MESSAGES.api_unreachable };
  }
  const body = (await parseJson(res)) as Record<string, unknown> | null;
  if (res.ok && body && typeof body === "object" && !Array.isArray(body)) return { ok: true, value: body as T };
  const code = typeof body?.error === "string" ? body.error : "api_error";
  const detail = typeof body?.detail === "string" ? body.detail : undefined;
  const message = detail ?? (typeof body?.message === "string" ? body.message : RUNTIME_MESSAGES.api_error);
  return { ok: false, status: res.status, code, message };
}

export const demoGet = <T = DemoBody>(path: string): Promise<DemoResult<T>> => call<T>(path, { method: "GET" });

/** A write: JSON body and an Idempotency-Key (new each call unless given, so a retry of the same action can reuse its key). */
export const demoPost = <T = DemoBody>(path: string, payload: object = {}, idempotencyKey: string = newIdempotencyKey()): Promise<DemoResult<T>> =>
  call<T>(path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) });
