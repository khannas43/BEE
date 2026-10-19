import { describe, expect, it, vi } from "vitest";
import { MANUFACTURER_ONBOARDING_DOCUMENT_KINDS } from "../documentKinds";
import { mapBackendDetail } from "../mapBackend";
import { createManufacturerOnboardingHttpClient, MANUFACTURER_ONBOARDING_BFF } from "../httpClient";

const DETAIL_FIXTURE = {
  id: "00000000-0000-4000-f000-000000000001",
  reference: "MOB/2026/00001",
  organisationId: "00000000-0000-4000-b000-000000000007",
  legalName: "Onboard Manufacturing Pvt Ltd",
  state: "director_review",
  version: 2,
  tradeLicenceUploaded: true,
  createdAt: "2026-10-01T12:00:00.000Z",
  draft: { cin: "U12345AB6789XYZ123456", declarationAccepted: true, agreementAccepted: true },
  documents: [{ documentKind: "trade_licence", latestVersion: 1, status: "uploaded" }],
  automatedChecks: [{ checkCode: "cin_format", outcome: "pass", checkedAt: "2026-10-01T12:01:00.000Z" }],
  lifecycle: [{ eventKind: "submit", fromState: "draft", toState: "submitted", actorRole: "manufacturer", occurredAt: "2026-10-01T12:01:00.000Z" }],
  fee: { amountInr: "5000.00", totalInr: "5000.00", feeRuleKey: "REG:manufacturer_onboarding", feeRuleVersion: 1 },
  payment: {
    paymentId: "00000000-0000-4000-f000-000000000002",
    amountInr: "5000.00",
    receiptNumber: "SIMRCPT-20261001-0001",
    status: "paid",
    settledAt: "2026-10-01T12:01:30.000Z",
  },
  directorDecision: { decision: "approve", decidedAt: "2026-10-02T12:00:00.000Z", note: "OK" },
  observation: { startedOn: "2026-10-02", endsOn: "2026-10-17" },
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("manufacturer onboarding HTTP adapter", () => {
  it("maps backend state to UI phase on detail", () => {
    const app = mapBackendDetail(DETAIL_FIXTURE as unknown as import("../mapBackend").BackendDetail);
    expect(app.phase).toBe("director_review");
    expect(app.version).toBe(2);
    expect(app.payment.amountInr).toBe("5000.00");
    expect(app.draft.cin).toBe("U12345AB6789XYZ123456");
    expect(app.observationEndsAt).toBeTruthy();
  });

  it("lists Director queue as director_review and monitoring includes those payments", async () => {
    const items = [
      { ...DETAIL_FIXTURE, id: "a", state: "director_review" },
      { ...DETAIL_FIXTURE, id: "b", state: "draft", version: 1 },
      { ...DETAIL_FIXTURE, id: "c", state: "automatic_checks_failed", version: 1 },
    ];
    const client = createManufacturerOnboardingHttpClient(async () =>
      jsonResponse({ items, count: items.length, authority: "spring-database" }),
    );
    const director = await client.listDirectorQueue();
    expect(director.map((x) => x.id)).toEqual(["a"]);
    const monitoring = await client.listMonitoringQueue();
    expect(monitoring.map((x) => x.id)).toEqual(["a"]);
  });

  it("filters monitoring queue phases", async () => {
    const items = [
      { ...DETAIL_FIXTURE, id: "o", state: "active_observation" },
      { ...DETAIL_FIXTURE, id: "h", state: "on_hold" },
      { ...DETAIL_FIXTURE, id: "d", state: "draft" },
    ];
    const client = createManufacturerOnboardingHttpClient(async () =>
      jsonResponse({ items, count: items.length, authority: "spring-database" }),
    );
    const rows = await client.listMonitoringQueue();
    expect(rows.map((x) => x.id).sort()).toEqual(["h", "o"]);
  });

  it("reuses editable draft or POST create with idempotency key", async () => {
    const calls: { url: string; method: string; body?: string; key?: string }[] = [];
    let listPass = 0;
    const client = createManufacturerOnboardingHttpClient(async (url, init) => {
      const method = init?.method ?? "GET";
      const key = new Headers(init?.headers).get("Idempotency-Key") ?? undefined;
      calls.push({ url: String(url), method, body: typeof init?.body === "string" ? init.body : undefined, key });
      if (String(url) === MANUFACTURER_ONBOARDING_BFF.list && method === "GET") {
        listPass += 1;
        if (listPass === 1) {
          return jsonResponse({ items: [{ ...DETAIL_FIXTURE, id: "draft-1", state: "draft", version: 3 }], count: 1, authority: "spring-database" });
        }
        return jsonResponse({ items: [], count: 0, authority: "spring-database" });
      }
      if (method === "POST" && String(url) === MANUFACTURER_ONBOARDING_BFF.list) {
        return jsonResponse({ ...DETAIL_FIXTURE, id: "new-id", state: "draft", version: 1 }, 201);
      }
      return jsonResponse(DETAIL_FIXTURE);
    });
    const reused = await client.defaultDraftId();
    expect(reused).toBe("draft-1");
    const created = await client.defaultDraftId();
    expect(created).toBe("new-id");
    const post = calls.find((c) => c.method === "POST" && c.url === MANUFACTURER_ONBOARDING_BFF.list);
    expect(post?.key).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    expect(JSON.parse(post!.body!)).toEqual({ legalName: "Aarav Appliances Pvt Ltd", draft: {} });
  });

  it("PATCH save includes version and draft payload", async () => {
    let patchBody: unknown;
    const client = createManufacturerOnboardingHttpClient(async (url, init) => {
      if (init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        return jsonResponse({ ...DETAIL_FIXTURE, version: 3 });
      }
      return jsonResponse(DETAIL_FIXTURE);
    });
    await client.saveDraft({
      id: DETAIL_FIXTURE.id,
      version: 2,
      draft: {
        legalName: "Aarav Appliances Pvt Ltd",
        cin: "X",
        gstin: "",
        registeredAddress: { line1: "1", line2: "", city: "Mumbai", state: "MH", pincode: "400001" },
        facilities: [],
        contacts: [],
        authorisedSignatory: { name: "A", email: "", phone: "", role: "" },
        annexureDocuments: [],
        declarationAccepted: true,
        agreementAccepted: false,
      },
    });
    expect(patchBody).toMatchObject({ version: 2, legalName: "Aarav Appliances Pvt Ltd" });
  });

  it("submit and director decision use versioned JSON commands", async () => {
    const bodies: unknown[] = [];
    const client = createManufacturerOnboardingHttpClient(async (_url, init) => {
      if (init?.method === "POST" && typeof init.body === "string") bodies.push(JSON.parse(init.body));
      return jsonResponse({ ...DETAIL_FIXTURE, version: 5 });
    });
    await client.submit({ id: DETAIL_FIXTURE.id, version: 4 });
    await client.directorApprove({ id: DETAIL_FIXTURE.id, version: 4, note: "yes" });
    await client.directorReject({ id: DETAIL_FIXTURE.id, version: 4, reason: "no" });
    await client.directorReturn({ id: DETAIL_FIXTURE.id, version: 4, reason: "need more" });
    expect(bodies[0]).toEqual({ version: 4 });
    expect(bodies[1]).toEqual({ version: 4, decision: "approve", note: "yes" });
    expect(bodies[2]).toEqual({ version: 4, decision: "reject", note: "no" });
    expect(bodies[3]).toEqual({ version: 4, decision: "return", note: "need more" });
  });

  it("anomaly commands use reason and resolution payloads", async () => {
    const bodies: unknown[] = [];
    const client = createManufacturerOnboardingHttpClient(async (_url, init) => {
      if (init?.method === "POST" && typeof init.body === "string") bodies.push(JSON.parse(init.body));
      return jsonResponse(DETAIL_FIXTURE);
    });
    await client.raiseAnomaly({ applicationId: DETAIL_FIXTURE.id, version: 2, summary: "Fee mismatch" });
    await client.directorResolve({ applicationId: DETAIL_FIXTURE.id, version: 3, note: "cleared" });
    await client.directorRevoke({ applicationId: DETAIL_FIXTURE.id, version: 3, reason: "revoked" });
    expect(bodies[0]).toEqual({ version: 2, reason: "Fee mismatch" });
    expect(bodies[1]).toEqual({ version: 3, resolution: "cleared", note: "cleared" });
    expect(bodies[2]).toEqual({ version: 3, resolution: "revoked", note: "revoked" });
  });

  it("uses distinct idempotency keys across repeated anomaly episodes", async () => {
    const keys: string[] = [];
    const client = createManufacturerOnboardingHttpClient(async (_url, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key") ?? "");
      return jsonResponse(DETAIL_FIXTURE);
    });
    await client.raiseAnomaly({ applicationId: DETAIL_FIXTURE.id, version: 1, summary: "first" });
    await client.raiseAnomaly({ applicationId: DETAIL_FIXTURE.id, version: 2, summary: "second" });
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every((k) => /^[A-Za-z0-9-]{16,64}$/.test(k))).toBe(true);
  });

  it("multipart document upload hits documents route", async () => {
    let url = "";
    let form: FormData | undefined;
    const client = createManufacturerOnboardingHttpClient(async (u, init) => {
      url = String(u);
      form = init?.body instanceof FormData ? init.body : undefined;
      return jsonResponse(DETAIL_FIXTURE);
    });
    const file = new File(["bytes"], "trade.pdf", { type: "application/pdf" });
    await client.uploadDocument({
      applicationId: DETAIL_FIXTURE.id,
      documentKind: "trade_licence",
      label: "Trade licence",
      file,
    });
    expect(url).toBe(MANUFACTURER_ONBOARDING_BFF.documents(DETAIL_FIXTURE.id));
    expect(form?.get("documentKind")).toBe("trade_licence");
    expect(form?.get("label")).toBe("Trade licence");
    expect(form?.get("file")).toBeInstanceOf(File);
  });

  it("does not expose observation-close routes on the adapter", () => {
    const client = createManufacturerOnboardingHttpClient(vi.fn());
    expect(Object.keys(client)).not.toContain("closeObservation");
    expect(JSON.stringify(MANUFACTURER_ONBOARDING_BFF)).not.toMatch(/observation.*close/i);
  });

  it("covers every required document kind constant", () => {
    expect(MANUFACTURER_ONBOARDING_DOCUMENT_KINDS).toContain("signed_agreement");
    expect(MANUFACTURER_ONBOARDING_DOCUMENT_KINDS.length).toBe(8);
  });
});
