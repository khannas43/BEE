// The public verification limiter (BL-143): windows, keys, memory bound, and who counts as one visitor without a trusted proxy.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, WINDOW_MS, verificationKey, limiterFor, SHARED_LIMIT, PER_ADDRESS_LIMIT } from "../../lib/server/rateLimit.ts";

test("a window allows its limit, then refuses with the seconds left, then opens again", () => {
  const l = new RateLimiter(3);
  const t0 = 1_000_000;
  assert.deepEqual([l.check("a", t0).allowed, l.check("a", t0 + 1).allowed, l.check("a", t0 + 2).allowed], [true, true, true]);
  const refused = l.check("a", t0 + 20_000);
  assert.equal(refused.allowed, false);
  assert.equal(refused.retryAfter, 40);
  assert.equal(l.check("a", t0 + WINDOW_MS - 1).allowed, false);
  assert.equal(l.check("a", t0 + WINDOW_MS).allowed, true, "a new window starts after a minute");
});

test("each key has its own window", () => {
  const l = new RateLimiter(1);
  assert.equal(l.check("a", 0).allowed, true);
  assert.equal(l.check("a", 1).allowed, false);
  assert.equal(l.check("b", 1).allowed, true);
});

test("a flood of invented keys cannot grow memory without bound", () => {
  const l = new RateLimiter(1, 50);
  for (let i = 0; i < 500; i++) l.check(`k${i}`, 0);
  assert.ok(l.windows.size <= 50);
  assert.equal(l.check("late", 1).allowed, true);
});

test("the wait is never below one second", () => {
  const l = new RateLimiter(1);
  l.check("a", 0);
  assert.equal(l.check("a", WINDOW_MS - 1).retryAfter, 1);
});

test("without a trusted proxy every visitor shares one window, whatever header they send", () => {
  const a = verificationKey(new Headers({ "x-forwarded-for": "203.0.113.7" }));
  const b = verificationKey(new Headers({ "x-forwarded-for": "198.51.100.9" }));
  const none = verificationKey(new Headers());
  assert.deepEqual([a.key, b.key, none.key], ["shared", "shared", "shared"], "an invented address cannot buy a fresh window");
  assert.equal(a.limit, SHARED_LIMIT);
  assert.ok(SHARED_LIMIT > PER_ADDRESS_LIMIT);
  assert.equal(limiterFor(5), limiterFor(5), "one limiter per limit");
});
