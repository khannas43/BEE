// The same limiter behind a trusted proxy (BEE_TRUST_PROXY=1): each forwarded address has its own window. Separate file: the flag is read once at import.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.BEE_TRUST_PROXY = "1";
const { verificationKey, PER_ADDRESS_LIMIT } = await import("../../lib/server/rateLimit.ts");

test("behind a trusted proxy the first forwarded address is the visitor", () => {
  const a = verificationKey(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
  assert.deepEqual([a.key, a.limit], ["ip:203.0.113.7", PER_ADDRESS_LIMIT]);
  assert.equal(verificationKey(new Headers({ "x-forwarded-for": "2001:db8::1" })).key, "ip:2001:db8::1");
});

test("a missing or malformed forwarded address falls back to the shared window", () => {
  for (const v of [undefined, "", "not an address", "<script>", "1".repeat(80)]) {
    const h = new Headers(v === undefined ? {} : { "x-forwarded-for": v });
    assert.equal(verificationKey(h).key, "shared", String(v));
  }
});
