// WP05.1a: model-application list/detail UI reads through the BFF with mocked responses.
// Does not call Spring or Keycloak. Authorization is whatever the mocked BFF returns —
// never a client-side org/role rule. Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  modelDashboardHref,
  READ_UI_MESSAGES,
  readModelApplication,
  readModelApplicationList,
  runtimeReadInit,
  stateLabel,
} from "../../lib/client/runtimeModelApplications.ts";

const NOVA_1 = {
  id: "00000000-0000-4000-c000-000000000001",
  reference: "LOCAL-MA-0001",
  organisation: "NOVA",
  brandName: "Nova Cool",
  category: "RAC",
  modelNumber: "NC-RAC-12D",
  state: "draft",
  version: 0,
  readBasis: ["own-org"],
};
const NOVA_2 = {
  id: "00000000-0000-4000-c000-000000000002",
  reference: "LOCAL-MA-0002",
  organisation: "NOVA",
  brandName: "Nova Cool",
  category: "RAC",
  modelNumber: "NC-RAC-18F",
  state: "fee_due",
  version: 0,
  readBasis: ["own-org"],
};
const PIXEL_3 = {
  id: "00000000-0000-4000-c000-000000000003",
  reference: "LOCAL-MA-0003",
  organisation: "PIXEL",
  brandName: "Aurora Air (synthetic principal)",
  category: "RAC",
  modelNumber: "AU-RAC-15X",
  state: "iame_scrutiny",
  version: 0,
  readBasis: ["own-org"],
};
const NOVA_4 = {
  id: "00000000-0000-4000-c000-000000000004",
  reference: "LOCAL-MA-0004",
  organisation: "NOVA",
  brandName: "Nova Cool",
  category: "RAC",
  modelNumber: "NC-RAC-24H",
  state: "bee_scrutiny",
  version: 0,
  readBasis: ["own-org"],
};

const NOVA_LIST = { authority: "spring-database", count: 3, items: [NOVA_1, NOVA_2, NOVA_4] };
const PIXEL_LIST = { authority: "spring-database", count: 1, items: [PIXEL_3] };
const EMPTY_LIST = { authority: "spring-database", count: 0, items: [] };

const NOT_FOUND = { error: "not_found", message: READ_UI_MESSAGES.not_found };
const NO_SESSION = { error: "no_session", message: READ_UI_MESSAGES.no_session };
const EXPIRED = { error: "session_expired", message: READ_UI_MESSAGES.session_expired };
const FORBIDDEN = { error: "no_read_scope", message: READ_UI_MESSAGES.no_read_scope };

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Mock BFF: cookie session decides the answer; Authorization is ignored (as the real BFF does). */
function mockBff(persona) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    const cookie = headers.get("cookie") || "";
    const authorization = headers.get("authorization");
    calls.push({ url: String(url), method: init.method || "GET", credentials: init.credentials, cache: init.cache, authorization, cookie, headerNames: [...headers.keys()] });

    const hasSession = /bee_session=/.test(cookie);
    // A browser bearer alone never grants access — same as no cookie.
    if (!hasSession) return json(401, NO_SESSION);

    if (String(url).endsWith("/api/runtime/model-applications") || String(url).endsWith("/api/runtime/model-applications/")) {
      if (persona === "expired") return json(401, EXPIRED);
      if (persona === "forbidden") return json(403, FORBIDDEN);
      if (persona === "empty") return json(200, EMPTY_LIST);
      if (persona === "nova") return json(200, NOVA_LIST);
      if (persona === "pixel") return json(200, PIXEL_LIST);
      return json(401, NO_SESSION);
    }

    const m = String(url).match(/\/api\/runtime\/model-applications\/([^/?#]+)$/);
    if (m) {
      if (persona === "expired") return json(401, EXPIRED);
      const id = decodeURIComponent(m[1]);
      const pool = persona === "nova" ? [NOVA_1, NOVA_2, NOVA_4] : persona === "pixel" ? [PIXEL_3] : [];
      const hit = pool.find((a) => a.id === id);
      // Cross-org and unknown share one 404 body — the client must not invent a different message.
      return hit ? json(200, hit) : json(404, NOT_FOUND);
    }
    return json(404, { error: "not_found", message: "not a BFF route in this mock" });
  };
  return { fetchImpl, calls };
}

function withCookie(personaFetch, sessionValue = "test-session") {
  return async (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", `bee_session=${sessionValue}`);
    return personaFetch(url, { ...init, headers });
  };
}

test("runtime reads send credentials and never an Authorization header", () => {
  const init = runtimeReadInit({ Authorization: "Bearer planted-token", "X-Custom": "1" });
  assert.equal(init.credentials, "include");
  assert.equal(init.cache, "no-store");
  assert.equal(init.method, "GET");
  const headers = new Headers(init.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("Authorization"), false);
  assert.equal(headers.get("X-Custom"), "1");
});

test("browser: Nova list shows three server-persisted rows (draft and pending included)", async () => {
  const { fetchImpl, calls } = mockBff("nova");
  const result = await readModelApplicationList(withCookie(fetchImpl));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.list.count, 3);
  assert.deepEqual(result.list.items.map((a) => a.reference), ["LOCAL-MA-0001", "LOCAL-MA-0002", "LOCAL-MA-0004"]);
  assert.deepEqual(result.list.items.map((a) => a.state), ["draft", "fee_due", "bee_scrutiny"]);
  assert.equal(result.list.items.some((a) => a.organisation === "PIXEL"), false);
  assert.equal(calls[0].credentials, "include");
  assert.equal(calls[0].authorization, null);
});

test("browser: PixelCert list shows one server-persisted row", async () => {
  const { fetchImpl } = mockBff("pixel");
  const result = await readModelApplicationList(withCookie(fetchImpl));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.list.count, 1);
  assert.equal(result.list.items[0].reference, "LOCAL-MA-0003");
  assert.equal(result.list.items[0].organisation, "PIXEL");
});

test("browser: selecting a list record reads detail through the BFF for the same id", async () => {
  const { fetchImpl, calls } = mockBff("nova");
  const list = await readModelApplicationList(withCookie(fetchImpl));
  assert.equal(list.ok, true);
  if (!list.ok) return;
  const chosen = list.list.items[1];
  const href = modelDashboardHref(chosen.id);
  assert.equal(href, `/app/model-label/model-dashboard?id=${chosen.id}`);
  const detail = await readModelApplication(chosen.id, withCookie(fetchImpl));
  assert.equal(detail.ok, true);
  if (!detail.ok) return;
  assert.equal(detail.application.reference, "LOCAL-MA-0002");
  assert.equal(detail.application.state, "fee_due");
  assert.equal(detail.application.version, 0);
  assert.deepEqual(detail.application.readBasis, ["own-org"]);
  assert.equal(calls.some((c) => c.url.includes(chosen.id)), true);
});

test("browser: cross-organisation and unknown ids share one not_found failure", async () => {
  const { fetchImpl } = mockBff("nova");
  const cross = await readModelApplication(PIXEL_3.id, withCookie(fetchImpl));
  const unknown = await readModelApplication("00000000-0000-4000-c000-000000009999", withCookie(fetchImpl));
  assert.equal(cross.ok, false);
  assert.equal(unknown.ok, false);
  if (cross.ok || unknown.ok) return;
  assert.deepEqual(cross.failure, unknown.failure);
  assert.equal(cross.failure.kind, "not_found");
  assert.equal(cross.failure.message, READ_UI_MESSAGES.not_found);
  // Client must not leak which case it was.
  assert.equal(JSON.stringify(cross.failure).includes("PIXEL"), false);
  assert.equal(JSON.stringify(cross.failure).includes("unknown"), false);
});

test("browser: no session cookie yields session denial on list and detail", async () => {
  const { fetchImpl, calls } = mockBff("nova");
  const list = await readModelApplicationList(fetchImpl);
  const detail = await readModelApplication(NOVA_1.id, fetchImpl);
  assert.equal(list.ok, false);
  assert.equal(detail.ok, false);
  if (list.ok || detail.ok) return;
  assert.equal(list.failure.kind, "session");
  assert.equal(list.failure.code, "no_session");
  assert.equal(list.failure.message, READ_UI_MESSAGES.no_session);
  assert.equal(detail.failure.kind, "session");
  assert.equal(calls.every((c) => !/bee_session=/.test(c.cookie)), true);
});

test("browser: session expiry / refresh refusal surfaces session_expired", async () => {
  const { fetchImpl } = mockBff("expired");
  const list = await readModelApplicationList(withCookie(fetchImpl));
  const detail = await readModelApplication(NOVA_1.id, withCookie(fetchImpl));
  assert.equal(list.ok, false);
  assert.equal(detail.ok, false);
  if (list.ok || detail.ok) return;
  assert.equal(list.failure.kind, "session");
  assert.equal(list.failure.code, "session_expired");
  assert.equal(list.failure.message, READ_UI_MESSAGES.session_expired);
  assert.equal(detail.failure.code, "session_expired");
});

test("browser: a bearer Authorization header cannot grant access without the session cookie", async () => {
  const { fetchImpl, calls } = mockBff("nova");
  const bearerOnly = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", "Bearer eyJhbGciOiJub25lIn0.nova.planted");
    // Intentionally no bee_session cookie.
    return fetchImpl(url, { ...init, headers });
  };
  const list = await readModelApplicationList(bearerOnly);
  const detail = await readModelApplication(NOVA_1.id, bearerOnly);
  assert.equal(list.ok, false);
  assert.equal(detail.ok, false);
  if (list.ok || detail.ok) return;
  assert.equal(list.failure.kind, "session");
  assert.equal(list.failure.code, "no_session");
  assert.equal(detail.failure.code, "no_session");
  // Even when a caller re-attaches a bearer after runtimeReadInit, the mock BFF
  // (like the real one) ignores it: no cookie → no access.
  assert.equal(calls.length >= 2, true);
  assert.equal(calls.every((c) => c.authorization && !/bee_session=/.test(c.cookie)), true);
});

test("browser: bearer attached after init still does not unlock records — cookie alone decides", async () => {
  // Proves the UI must not treat a planted bearer as authority: mock ignores Authorization.
  const { fetchImpl } = mockBff("pixel");
  const cookiePlusForeignBearer = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", "bee_session=pixel-session");
    headers.set("Authorization", "Bearer eyJhbGciOiJub25lIn0.nova.planted");
    return fetchImpl(url, { ...init, headers });
  };
  const list = await readModelApplicationList(cookiePlusForeignBearer);
  assert.equal(list.ok, true);
  if (!list.ok) return;
  // Pixel cookie → Pixel list; Nova bearer did not widen scope.
  assert.equal(list.list.count, 1);
  assert.equal(list.list.items[0].organisation, "PIXEL");
  const cross = await readModelApplication(NOVA_1.id, cookiePlusForeignBearer);
  assert.equal(cross.ok, false);
  if (cross.ok) return;
  assert.equal(cross.failure.kind, "not_found");
});

test("browser: 403 no_read_scope is shown without inventing client-side permission rules", async () => {
  const { fetchImpl } = mockBff("forbidden");
  const list = await readModelApplicationList(withCookie(fetchImpl));
  assert.equal(list.ok, false);
  if (list.ok) return;
  assert.equal(list.failure.kind, "forbidden");
  assert.equal(list.failure.code, "no_read_scope");
  assert.equal(list.failure.message, READ_UI_MESSAGES.no_read_scope);
});

test("browser: empty list is a distinct no-records state", async () => {
  const { fetchImpl } = mockBff("empty");
  const list = await readModelApplicationList(withCookie(fetchImpl));
  assert.equal(list.ok, true);
  if (!list.ok) return;
  assert.equal(list.list.count, 0);
  assert.equal(READ_UI_MESSAGES.empty_list.includes("No model applications"), true);
});

test("detail href stays on model-dashboard; state labels are humanised", () => {
  assert.equal(modelDashboardHref(), "/app/model-label/model-dashboard");
  assert.equal(modelDashboardHref(NOVA_1.id), `/app/model-label/model-dashboard?id=${NOVA_1.id}`);
  assert.equal(stateLabel("bee_scrutiny"), "bee scrutiny");
  assert.equal(stateLabel("draft"), "draft");
});
