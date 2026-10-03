// WP06.1a review fix: the multipart body is bounded while it is read, not only by Content-Length.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readBoundedBody } from "../../lib/server/boundedBody.ts";

function streamRequest(chunkCount, chunkSize, onPull) {
  let sent = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (sent >= chunkCount) return controller.close();
      sent += 1;
      onPull?.(sent);
      controller.enqueue(new Uint8Array(chunkSize).fill(sent % 256));
    },
  });
  // A streamed body carries no Content-Length, exactly the case the guard must handle.
  return new Request("http://127.0.0.1/upload", { method: "POST", body, duplex: "half" });
}

test("a body within the limit is returned intact", async () => {
  const bytes = await readBoundedBody(streamRequest(3, 10), 100);
  assert.equal(bytes?.byteLength, 30);
  assert.equal(new Uint8Array(bytes)[0], 1);
  assert.equal(new Uint8Array(bytes)[29], 3);
});

test("a body exactly at the limit is accepted", async () => {
  assert.equal((await readBoundedBody(streamRequest(4, 25), 100))?.byteLength, 100);
});

test("a body over the limit with no Content-Length is rejected and the stream stops early", async () => {
  let pulled = 0;
  const bytes = await readBoundedBody(streamRequest(10_000, 1024, (n) => (pulled = n)), 4096);
  assert.equal(bytes, null);
  assert.ok(pulled < 100, `reader kept pulling after the limit (${pulled} chunks)`);
});

test("an empty request body is an empty buffer, not an error", async () => {
  const bytes = await readBoundedBody(new Request("http://127.0.0.1/upload", { method: "POST" }), 100);
  assert.equal(bytes?.byteLength, 0);
});
