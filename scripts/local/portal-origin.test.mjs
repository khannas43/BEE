// Unit tests for lib/server/portalOrigin.ts. Run: npm run web:test
import assert from "node:assert/strict";
import test from "node:test";
import { portalHostsMatch, logoutRequestFromPortal } from "../../lib/server/portalOrigin.ts";

const configured = "http://127.0.0.1:3100";

const req = (headers) => ({ headers: { get: (k) => headers[k.toLowerCase()] ?? null } });

test("portalHostsMatch treats localhost and 127.0.0.1 as the same port", () => {
  assert.equal(portalHostsMatch("localhost:3100", "127.0.0.1:3100"), true);
  assert.equal(portalHostsMatch("127.0.0.1:3100", "127.0.0.1:3100"), true);
  assert.equal(portalHostsMatch("localhost:3000", "127.0.0.1:3100"), false);
});

test("logoutRequestFromPortal accepts configured Origin and localhost alias", () => {
  assert.equal(logoutRequestFromPortal(req({ origin: configured }), configured), true);
  assert.equal(logoutRequestFromPortal(req({ origin: "http://localhost:3100" }), configured), true);
  assert.equal(logoutRequestFromPortal(req({ origin: "http://127.0.0.1:3000" }), configured), false);
  assert.equal(logoutRequestFromPortal(req({ origin: "http://127.0.0.1:9999" }), configured), false);
});

test("logoutRequestFromPortal accepts same-origin form POST without Origin", () => {
  assert.equal(
    logoutRequestFromPortal(
      req({ host: "127.0.0.1:3100", "sec-fetch-site": "same-origin" }),
      configured,
    ),
    true,
  );
  assert.equal(
    logoutRequestFromPortal(
      req({ host: "localhost:3100", "sec-fetch-site": "same-origin" }),
      configured,
    ),
    true,
  );
});

test("logoutRequestFromPortal rejects same-site other port without Origin", () => {
  assert.equal(
    logoutRequestFromPortal(
      req({ host: "127.0.0.1:3100", "sec-fetch-site": "same-site", referer: "http://127.0.0.1:3000/" }),
      configured,
    ),
    false,
  );
});

test("logoutRequestFromPortal falls back to Referer when Origin is missing", () => {
  assert.equal(
    logoutRequestFromPortal(req({ referer: "http://localhost:3100/app" }), configured),
    true,
  );
});
