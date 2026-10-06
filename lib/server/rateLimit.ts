/**
 * A small in-memory rate limiter for the public verification route (BL-143). A fixed one-minute window per key. In memory and per
 * instance: several instances would each allow the limit, and a shared store belongs to the production hardening (BL-130).
 *
 * Who is "one visitor": Next.js route handlers cannot see the connection's address, so the portal trusts the forwarded address only when
 * BEE_TRUST_PROXY=1 says a proxy that overwrites it sits in front (then each visitor has their own window). Otherwise a visitor could
 * dodge the limit by inventing the header, so every request shares one window with a higher limit, which cannot be dodged.
 */
export const WINDOW_MS = 60_000;

export interface Verdict {
  allowed: boolean;
  /** Seconds to wait when refused. */
  retryAfter: number;
}

export class RateLimiter {
  readonly windows = new Map<string, { start: number; count: number }>();
  private readonly limit: number;
  private readonly maxKeys: number;

  constructor(limit: number, maxKeys = 10_000) {
    this.limit = limit;
    this.maxKeys = maxKeys;
  }

  check(key: string, now: number = Date.now()): Verdict {
    let w = this.windows.get(key);
    if (!w || now - w.start >= WINDOW_MS) {
      if (!w && this.windows.size >= this.maxKeys) this.purge(now);
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= this.limit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000)) };
    w.count += 1;
    return { allowed: true, retryAfter: 0 };
  }

  /** Drops finished windows; if the table is still full of live ones, starts over (a flood of invented keys cannot grow memory). */
  private purge(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= WINDOW_MS) this.windows.delete(k);
    if (this.windows.size >= this.maxKeys) this.windows.clear();
  }
}

const num = (v: string | undefined, d: number) => (v && /^[0-9]{1,6}$/.test(v) && Number(v) > 0 ? Number(v) : d);
export const PER_ADDRESS_LIMIT = num(process.env.BEE_VERIFY_LIMIT_PER_ADDRESS, 60);
export const SHARED_LIMIT = num(process.env.BEE_VERIFY_LIMIT_SHARED, 300);
const TRUST_PROXY = process.env.BEE_TRUST_PROXY === "1";

const ADDRESS = /^[0-9a-fA-F:.]{3,45}$/;

/** The key and the limiter that apply to this request. */
export function verificationKey(headers: Headers): { key: string; limit: number } {
  if (TRUST_PROXY) {
    const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    if (ADDRESS.test(first)) return { key: `ip:${first}`, limit: PER_ADDRESS_LIMIT };
  }
  return { key: "shared", limit: SHARED_LIMIT };
}

const limiters = new Map<number, RateLimiter>();
/** The process-wide limiter for a limit (one for the per-address windows, one for the shared window). */
export function limiterFor(limit: number): RateLimiter {
  let l = limiters.get(limit);
  if (!l) {
    l = new RateLimiter(limit);
    limiters.set(limit, l);
  }
  return l;
}
