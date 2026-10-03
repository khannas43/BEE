import { vi } from "vitest";

/** One in-flight `fetch` the tests settle by hand. */
export interface DeferredFetch {
  url: string;
  init?: RequestInit;
  resolve: (body: unknown, status?: number) => void;
  reject: (error: unknown) => void;
}

const pending: DeferredFetch[] = [];

/** Replaces `globalThis.fetch` with a queue of responses that do not settle until the test says so. */
export function installDeferredFetch(): void {
  pending.length = 0;
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Promise((resolve, reject) => {
      pending.push({
        url,
        init,
        resolve(body: unknown, status = 200) {
          resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
        },
        reject,
      });
    });
  };
  vi.stubGlobal("fetch", fetchImpl);
}

export function deferredFetches(): readonly DeferredFetch[] {
  return pending;
}

export function idempotencyKey(call: DeferredFetch): string {
  return new Headers(call.init?.headers).get("Idempotency-Key") ?? "";
}
