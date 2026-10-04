// The request-log reader must not lose lines to a log rotation that happens between a mark and the read. Run: npm run web:test
// The portal rotates its log at 5 MiB and the suite writes several MiB per run, so a rotation in the middle of a check is a matter of time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync, renameSync, rmSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const dir = mkdtempSync(join(tmpdir(), "request-logs-"));
process.env.BEE_REQUEST_LOGS_DIR = dir;
const logs = createRequire(import.meta.url)("./request-logs.cjs");
const WEB = join(dir, "web-requests.jsonl");
const line = (id, layer = "web") => JSON.stringify({ layer, correlationId: id }) + "\n";
const ids = (text) => text.split("\n").filter(Boolean).map((l) => JSON.parse(l).correlationId);
const reset = () => { for (const f of readdirSync(dir)) rmSync(join(dir, f)); };
// Rotated files must look older than the current one, as they are in life.
const older = (name, seconds) => { const t = new Date(Date.now() - seconds * 1000); utimesSync(join(dir, name), t, t); };
// The portal's rotation (lib/server/requestLog.ts rotate): web-requests.jsonl -> .1, .1 -> .2, .2 -> .3
const rotate = () => {
  for (const [from, to] of [["web-requests.2.jsonl", "web-requests.3.jsonl"], ["web-requests.1.jsonl", "web-requests.2.jsonl"], ["web-requests.jsonl", "web-requests.1.jsonl"]]) {
    try { renameSync(join(dir, from), join(dir, to)); } catch {}
  }
};

test("without a rotation, only what was written after the mark is returned", () => {
  reset();
  writeFileSync(WEB, line("old-1") + line("old-2"));
  const m = logs.mark();
  appendFileSync(WEB, line("new-1") + line("new-2"));
  assert.deepEqual(ids(logs.since(m, "web")), ["new-1", "new-2"]);
  assert.deepEqual(logs.count(m), { api: 0, web: 2 });
});

test("a rotation after the mark loses nothing: the rest of the marked file and the new file are both read", () => {
  reset();
  writeFileSync(WEB, line("before-mark"));
  const m = logs.mark();
  appendFileSync(WEB, line("written-before-rotation"));
  rotate();
  older("web-requests.1.jsonl", 60);
  writeFileSync(WEB, line("written-after-rotation"));
  assert.deepEqual(ids(logs.since(m, "web")), ["written-before-rotation", "written-after-rotation"], "nothing lost, nothing from before the mark");
  const t = logs.trace("written-before-rotation", m);
  assert.equal(t.web.length, 1, "a lookup by correlation ID finds a line written just before the rotation");
});

test("two rotations after the mark are still followed, oldest first", () => {
  reset();
  writeFileSync(WEB, line("before-mark"));
  const m = logs.mark();
  appendFileSync(WEB, line("a"));
  rotate();
  older("web-requests.1.jsonl", 120);
  writeFileSync(WEB, line("b"));
  rotate();
  older("web-requests.2.jsonl", 120);
  older("web-requests.1.jsonl", 60);
  writeFileSync(WEB, line("c"));
  assert.deepEqual(ids(logs.since(m, "web")), ["a", "b", "c"]);
});

test("a mark taken after a rotation reads only the new file", () => {
  reset();
  writeFileSync(WEB, line("x"));
  rotate();
  older("web-requests.1.jsonl", 60);
  writeFileSync(WEB, line("y"));
  const m = logs.mark();
  appendFileSync(WEB, line("z"));
  assert.deepEqual(ids(logs.since(m, "web")), ["z"]);
});

test("if the marked file has been rotated out of retention, everything that still exists is returned", () => {
  reset();
  writeFileSync(WEB, line("gone"));
  const m = logs.mark();
  rmSync(WEB);
  writeFileSync(WEB, line("kept-1") + line("kept-2"));
  assert.deepEqual(ids(logs.since(m, "web")), ["kept-1", "kept-2"]);
});

test("a log that does not exist yet reads as empty, and the console logs still read from their mark", () => {
  reset();
  const m = logs.mark();
  assert.equal(logs.since(m, "web"), "");
  writeFileSync(join(dir, "web.log"), "console-1\n");
  const m2 = logs.mark();
  appendFileSync(join(dir, "web.log"), "console-2\n");
  assert.equal(logs.since(m2, "webConsole"), "console-2\n");
  rmSync(dir, { recursive: true, force: true });
});
