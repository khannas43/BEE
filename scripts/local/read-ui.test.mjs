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

test("a request that never reaches the BFF is shown as unreachable, not left loading", async () => {
  const offline = async () => {
    throw new TypeError("Failed to fetch");
  };
  for (const read of [await readModelApplicationList(offline), await readModelApplication(NOVA_1.id, offline)]) {
    assert.equal(read.ok, false);
    assert.equal(read.failure.kind, "unavailable");
    assert.equal(read.failure.message, READ_UI_MESSAGES.api_unreachable);
  }
});

test("detail href stays on model-dashboard; state labels are humanised", () => {
  assert.equal(modelDashboardHref(), "/app/model-label/model-dashboard");
  assert.equal(modelDashboardHref(NOVA_1.id), `/app/model-label/model-dashboard?id=${NOVA_1.id}`);
  assert.equal(stateLabel("bee_scrutiny"), "bee scrutiny");
  assert.equal(stateLabel("draft"), "draft");
});

test("runtime routes: Spring identity menu for dashboard, draft form and finance queue, not the preview role", async () => {
  const { RUNTIME_ROUTES, runtimeNavFor, runtimeRouteFor } = await import("../../lib/runtimeRoutes.ts");
  assert.deepEqual(RUNTIME_ROUTES.map((r) => r.href), [
    "/app/administration/fee-rules",
    "/app/finance/receipt",
    "/app/administration/rating-formula",
    "/app/workflow/personal-inbox",
    "/app/workflow/my-approvals",
    "/app/workflow/application-review",
    "/app/workflow/workflow-history",
    "/app/workflow/escalation-dashboard",
    "/app/model-label/model-dashboard",
    "/app/model-label/new-model-application",
    "/app/finance/finance-queue",
    "/app/model-label/iame-scrutiny",
    "/app/model-label/bee-scrutiny",
    "/app/model-label/rating-calculation",
    "/app/model-label/director-approval",
  ]);
  assert.equal(runtimeNavFor([{ role: "manufacturer", scope: "own-org" }]).length, 3);
  assert.equal(runtimeNavFor([{ role: "agency", scope: "own-org" }]).length, 3);
  assert.deepEqual(runtimeNavFor([{ role: "finance", scope: "all" }]).map((r) => r.href), ["/app/workflow/personal-inbox", "/app/finance/finance-queue"], "Finance gets its queue and the inbox");
  assert.equal(runtimeNavFor([{ role: "manufacturer", scope: "own-org" }]).some((r) => r.href === "/app/finance/finance-queue"), false, "an applicant never gets the Finance entry");
  assert.deepEqual(runtimeNavFor([{ role: "iame", scope: "assigned" }]).map((r) => r.href), ["/app/workflow/personal-inbox", "/app/model-label/iame-scrutiny"], "IAME gets only its scrutiny screen");
  assert.equal(runtimeNavFor([{ role: "finance", scope: "all" }]).some((r) => r.href === "/app/model-label/iame-scrutiny"), false, "Finance never gets the IAME entry");
  assert.deepEqual(runtimeNavFor([{ role: "reviewer", scope: "assigned" }]).map((r) => r.href), ["/app/workflow/personal-inbox", "/app/model-label/bee-scrutiny"], "the Reviewer gets only BEE scrutiny");
  assert.equal(runtimeNavFor([{ role: "iame", scope: "assigned" }]).some((r) => r.href === "/app/model-label/bee-scrutiny"), false, "IAME never gets the Reviewer entry");
  assert.deepEqual(runtimeNavFor([{ role: "programme", scope: "all" }]).map((r) => r.href), ["/app/workflow/personal-inbox", "/app/model-label/rating-calculation"], "Programme gets only the rating screen");
  assert.equal(runtimeNavFor([{ role: "reviewer", scope: "assigned" }]).some((r) => r.href === "/app/model-label/rating-calculation"), false, "the Reviewer never gets the Programme entry");
  assert.deepEqual(runtimeNavFor([{ role: "director", scope: "all" }]).map((r) => r.href), ["/app/workflow/personal-inbox", "/app/workflow/my-approvals", "/app/model-label/director-approval"], "the Director gets only the approval screen");
  assert.deepEqual(runtimeNavFor([{ role: "secretary", scope: "all" }]).map((r) => r.href), ["/app/workflow/personal-inbox", "/app/workflow/my-approvals", "/app/model-label/director-approval"], "the Secretary gets the same approval screen, for its own stage");
  assert.equal(runtimeNavFor([{ role: "programme", scope: "all" }]).some((r) => r.href === "/app/model-label/director-approval"), false, "Programme never gets the Director entry");
  assert.deepEqual(runtimeNavFor([{ role: "admin", scope: "all" }]).map((r) => r.href), [], "a role alone no longer brings the fee-rule or rating-scheme entry");
  assert.deepEqual(runtimeNavFor([{ role: "admin", scope: "all" }], ["fee_rule_manage", "rating_scheme_manage"]).map((r) => r.href), ["/app/administration/fee-rules", "/app/administration/rating-formula"], "the Administrator, who holds both permissions, gets both screens");
  assert.deepEqual(runtimeNavFor([{ role: "finance", scope: "all" }], ["fee_rule_manage"]).map((r) => r.href), ["/app/administration/fee-rules", "/app/workflow/personal-inbox", "/app/finance/finance-queue"], "a role given the permission later gets the entry, in menu order, beside its own entries");
  assert.equal(runtimeNavFor([{ role: "finance", scope: "all" }], ["rating_scheme_manage"]).some((r) => r.href === "/app/administration/fee-rules"), false, "one permission does not bring the other screen");
  assert.deepEqual(runtimeNavFor([{ role: "finance", scope: "all" }], ["fee_confirmation_correct"]).map((r) => r.href), ["/app/finance/receipt", "/app/workflow/personal-inbox", "/app/finance/finance-queue"], "Finance, which holds the correction permission, gets the receipts screen");
  assert.equal(runtimeNavFor([{ role: "admin", scope: "all" }], ["fee_rule_manage", "rating_scheme_manage"]).some((r) => r.href === "/app/finance/receipt"), false, "the Administrator does not hold the correction permission");
  assert.deepEqual(runtimeNavFor([{ role: "laboratory", scope: "assigned" }], ["fee_rule_manage"]).map((r) => r.href), ["/app/administration/fee-rules"], "the permission alone is enough for the entry; no other entry comes with it");
  assert.equal(runtimeNavFor([{ role: "finance", scope: "all" }]).some((r) => r.href === "/app/administration/fee-rules"), false, "Finance does not get the fee-rule entry without the permission");
  for (const roles of [null, [], [{ role: "laboratory", scope: "assigned" }], [{ role: "auditor", scope: "all" }]]) {
    assert.equal(runtimeNavFor(roles).length, 0, JSON.stringify(roles));
  }
  assert.ok(runtimeRouteFor("/app/model-label/model-dashboard"));
  assert.ok(runtimeRouteFor("/app/model-label/new-model-application"));
  assert.ok(runtimeRouteFor("/app/finance/finance-queue"));
  assert.ok(runtimeRouteFor("/app/model-label/iame-scrutiny"));
  assert.ok(runtimeRouteFor("/app/model-label/bee-scrutiny"));
  assert.ok(runtimeRouteFor("/app/model-label/rating-calculation"));
  assert.ok(runtimeRouteFor("/app/model-label/director-approval"));
  assert.ok(runtimeRouteFor("/app/administration/fee-rules"));
  assert.ok(runtimeRouteFor("/app/administration/rating-formula"));
  assert.ok(runtimeRouteFor("/app/finance/receipt"));
  assert.ok(runtimeRouteFor("/app/workflow/personal-inbox"));
  assert.ok(runtimeRouteFor("/app/workflow/my-approvals"));
  for (const p of ["application-review", "workflow-history", "escalation-dashboard"]) {
    assert.ok(runtimeRouteFor(`/app/workflow/${p}`), p);
    assert.equal(runtimeNavFor([{ role: "director", scope: "all" }]).some((r) => r.href.endsWith(p)), false, `${p} is reached by link, not by a menu entry`);
  }
  for (const p of ["/app/registrations/record", "/app", "/app/model-label/model-dashboard/x"]) {
    assert.equal(runtimeRouteFor(p), undefined, p);
  }
  assert.deepEqual([...runtimeRouteFor("/app/model-label/model-dashboard").implemented], ["List", "View detail", "Edit draft", "Submit draft", "See why it was returned", "Edit and resubmit", "See why it was rejected", "See the history"]);
  assert.deepEqual([...runtimeRouteFor("/app/model-label/new-model-application").implemented], ["Create draft", "Edit draft", "Upload test reports", "Submit draft", "Edit and resubmit a returned application"]);
  assert.deepEqual([...runtimeRouteFor("/app/finance/finance-queue").implemented], ["List fee-due applications", "View fee and evidence", "Confirm fee received"]);
  assert.deepEqual([...runtimeRouteFor("/app/model-label/iame-scrutiny").implemented], ["List assigned applications", "View evidence and test reports", "Record finding and forward", "Return to the applicant", "Reject permanently", "See the earlier steps and notes"]);
  assert.deepEqual([...runtimeRouteFor("/app/model-label/bee-scrutiny").implemented], ["List assigned applications", "View evidence and test reports", "Forward to rating", "Return to the applicant", "Reject permanently", "See the earlier steps and notes"]);
  assert.deepEqual([...runtimeRouteFor("/app/model-label/rating-calculation").implemented], ["List applications awaiting a rating", "View evidence and test reports", "Compute and record a provisional local rating", "Reject permanently", "See the earlier steps and notes"]);
  assert.deepEqual([...runtimeRouteFor("/app/model-label/director-approval").implemented], ["List applications awaiting your decision", "View the rating, evidence and test reports", "Recommend approval (Director)", "Give final approval (Secretary)", "Return to the applicant", "Reject permanently", "See the earlier steps and notes"]);
});

test("draft idempotency gate reuses a key until cleared or the payload changes", async () => {
  const { DraftIdempotencyGate } = await import("../../lib/client/runtimeModelDrafts.ts");
  const gate = new DraftIdempotencyGate();
  const body = { brandId: "x", category: "RAC", modelNumber: "A" };
  const k1 = gate.keyFor(body);
  const k2 = gate.keyFor(body);
  assert.equal(k1, k2);
  gate.clear();
  assert.notEqual(gate.keyFor(body), k1);
  assert.notEqual(gate.keyFor({ ...body, modelNumber: "B" }), k1);
});
