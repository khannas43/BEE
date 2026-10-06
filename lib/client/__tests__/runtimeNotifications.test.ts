import { describe, expect, it, vi } from "vitest";
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
  parseNotificationList,
  readNotifications,
} from "@/lib/client/runtimeNotifications";

const APP = "3d6f0a8e-0000-4000-a000-000000000001";
const NID = "3d6f0a8e-0000-4000-a000-0000000000b1";

const listBody = {
  unread: 1,
  items: [
    {
      id: NID,
      kind: "fee_due",
      message: "Fee is due for your application.",
      applicationId: APP,
      reference: "NOVA-1",
      createdAt: "2026-10-01T10:00:00.000Z",
      read: false,
    },
  ],
};

describe("runtimeNotifications", () => {
  it("parseNotificationList accepts the documented shape", () => {
    expect(parseNotificationList(listBody)).toEqual(listBody);
  });

  it("parseNotificationList accepts the seeded fixtures' ids, whose version and variant digits are not RFC 4122 ones", () => {
    const seeded = { ...listBody, items: [{ ...listBody.items[0], applicationId: "00000000-0000-4000-c000-000000000002", id: "00000000-0000-4000-a000-0000000000b1" }] };
    expect(parseNotificationList(seeded)).not.toBeNull();
    expect(parseNotificationList({ ...listBody, items: [{ ...listBody.items[0], applicationId: "not-an-id" }] })).toBeNull();
  });

  it("parseNotificationList rejects extra fields and a bad kind", () => {
    expect(parseNotificationList({ ...listBody, extra: true })).toBeNull();
    expect(parseNotificationList({ ...listBody, items: [{ ...listBody.items[0], kind: "unknown" }] })).toBeNull();
  });

  it("readNotifications calls GET /api/runtime/notifications", async () => {
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify(listBody), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const r = await readNotifications(fetchImpl);
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("/api/runtime/notifications", expect.anything());
  });

  it("markNotificationRead POSTs without a body", async () => {
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ id: NID, unread: 0 }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const r = await markNotificationRead(NID, fetchImpl);
    expect(r.ok).toBe(true);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBeNull();
  });

  it("markAllNotificationsRead POSTs read-all", async () => {
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () =>
      new Response(JSON.stringify({ marked: 2, unread: 0 }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    const r = await markAllNotificationsRead(fetchImpl);
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith("/api/runtime/notifications/read-all", expect.anything());
  });

  it("notificationHref maps the four kinds", () => {
    expect(notificationHref({ kind: "returned", applicationId: APP })).toBe(`/app/model-label/new-model-application?edit=${APP}`);
    expect(notificationHref({ kind: "approved", applicationId: APP })).toBe(`/app/model-label/label-preview?id=${APP}`);
    expect(notificationHref({ kind: "fee_due", applicationId: APP })).toBe(`/app/model-label/model-dashboard?id=${APP}`);
    expect(notificationHref({ kind: "rejected", applicationId: APP })).toBe(`/app/model-label/model-dashboard?id=${APP}`);
  });
});
