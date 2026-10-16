// The demonstration pass-through checks every path segment like the contract routes do (springIdSegment). Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { springIdSegment } from "../../lib/server/apiContract.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

test("a dot segment, an empty one and anything outside the safe set become a dash", () => {
  for (const bad of ["..", ".", "", "a/b", "a b", "%2e%2e", "x".repeat(129), "a;b", "é"]) assert.equal(springIdSegment(bad), "-", JSON.stringify(bad));
  for (const good of ["payments", "read-all", "compliance-risk", "00000000-0000-4000-c200-000000000101", "BEEQ-S2D0000001", "a.b_c~d"]) assert.equal(springIdSegment(good), good);
});

test("the demonstration route applies it to every segment before encoding", () => {
  const src = fs.readFileSync(path.join(ROOT, "app/api/runtime/demo/[...path]/route.ts"), "utf8");
  assert.match(src, /path\.map\(springIdSegment\)\.map\(encodeURIComponent\)/);
});
