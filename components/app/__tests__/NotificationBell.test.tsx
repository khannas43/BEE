import { act, cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/app/notifications/NotificationBell";
import { deferredFetches, installDeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";
import { useSpringIdentity } from "@/components/app/SessionBadge";

const APP = "3d6f0a8e-0000-4000-a000-000000000001";
const NID = "3d6f0a8e-0000-4000-a000-0000000000b1";

const list = (unread: number) => ({
  unread,
  items: unread
    ? [
        {
          id: NID,
          kind: "fee_due",
          message: "Fee due",
          applicationId: APP,
          reference: "X",
          createdAt: "2026-10-01T10:00:00.000Z",
          read: false,
        },
      ]
    : [],
});

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: vi.fn(() => ({
    status: "signed-in" as const,
    me: { displayName: "Nova", effectiveRoles: [{ role: "manufacturer", scope: "own-org" }], organisations: [] },
  })),
  refreshIdentity: vi.fn(() =>
    Promise.resolve({
      status: "signed-in" as const,
      me: { displayName: "Nova", effectiveRoles: [{ role: "manufacturer", scope: "own-org" }], organisations: [] },
    }),
  ),
}));

vi.mock("@/components/app/kit/useRuntimeRead", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/app/kit/useRuntimeRead")>();
  return {
    ...actual,
    useRevalidation: () => ({ epoch: 0, restores: 0, refresh: vi.fn() }),
  };
});

async function settleNotifications(body: unknown, status = 200) {
  await act(async () => {
    const call = deferredFetches().find((c) => c.url.endsWith("/api/runtime/notifications"));
    if (!call) throw new Error(`no notifications fetch; got ${deferredFetches().map((c) => c.url).join(", ")}`);
    call.resolve(body, status);
  });
}

describe("NotificationBell", () => {
  beforeEach(() => {
    installDeferredFetch();
    vi.mocked(useSpringIdentity).mockReturnValue({
      status: "signed-in",
      me: { displayName: "Nova", effectiveRoles: [{ role: "manufacturer", scope: "own-org" }], organisations: [] },
    });
  });

  it("is hidden when signed out", () => {
    vi.mocked(useSpringIdentity).mockReturnValue({ status: "signed-out" });
    render(<NotificationBell />);
    expect(screen.queryByTestId("notification-bell")).toBeNull();
  });

  it("shows the badge and aria-label with the count", async () => {
    cleanup();
    render(<NotificationBell />);
    await settleNotifications(list(3));
    expect(screen.getByTestId("notification-bell-badge").textContent).toBe("3");
    expect(screen.getByTestId("notification-bell").getAttribute("aria-label")).toBe("Notifications, 3 unread");
  });

  it('shows "9+" above nine unread', async () => {
    cleanup();
    render(<NotificationBell />);
    await settleNotifications(list(12));
    expect(screen.getByTestId("notification-bell-badge").textContent).toBe("9+");
  });

  it("shows no badge when the read fails", async () => {
    cleanup();
    render(<NotificationBell />);
    await settleNotifications({ error: "no_session" }, 401);
    expect(screen.queryByTestId("notification-bell-badge")).toBeNull();
  });
});
