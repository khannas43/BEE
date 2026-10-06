import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notifications } from "@/components/app/notifications/Notifications";
import { deferredFetches, installDeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";

const APP = "3d6f0a8e-0000-4000-a000-000000000001";
const NID = "3d6f0a8e-0000-4000-a000-0000000000b1";

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ children, action }: { children: ReactNode; action?: ReactNode }) => (
    <div>
      {action}
      {children}
    </div>
  ),
}));

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => ({
    status: "signed-in" as const,
    me: { displayName: "Nova", effectiveRoles: [{ role: "manufacturer", scope: "own-org" }], organisations: [] },
  }),
  rolesText: () => "manufacturer",
  orgsText: () => "NOVA",
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

const item = (read: boolean) => ({
  id: NID,
  kind: "returned",
  message: "Returned for changes.",
  applicationId: APP,
  reference: "NOVA-1",
  createdAt: "2026-10-01T10:00:00.000Z",
  read,
});

async function load(body: unknown, status = 200) {
  cleanup();
  render(<Notifications module={"model-label" as never} screen={"notifications" as never} />);
  await act(async () => {
    deferredFetches()[0].resolve(body, status);
  });
}

describe("Notifications page", () => {
  beforeEach(() => installDeferredFetch());

  it("lists items and mark-read controls", async () => {
    await load({ unread: 1, items: [item(false)] });
    expect(screen.getByTestId(`notifications-item-${NID}`)).toBeTruthy();
    expect(screen.getByTestId(`notifications-unread-dot-${NID}`)).toBeTruthy();
    expect(screen.getByTestId(`notifications-open-${NID}`).getAttribute("href")).toContain(APP);
    expect(screen.getByTestId("notifications-mark-read-" + NID)).toBeTruthy();
    expect(screen.getByTestId("notifications-mark-all")).toBeTruthy();
  });

  it("shows empty state", async () => {
    await load({ unread: 0, items: [] });
    expect(screen.getByTestId("notifications-empty")).toBeTruthy();
  });

  it("shows an error when the list read fails", async () => {
    await load({ error: "no_session" }, 401);
    expect(screen.getByTestId("notifications-error")).toBeTruthy();
  });

  it("mark one triggers a follow-up read", async () => {
    await load({ unread: 1, items: [item(false)] });
    await act(async () => {
      fireEvent.click(screen.getByTestId(`notifications-mark-read-${NID}`));
    });
    const markCall = deferredFetches().find((c) => c.url.includes("/read") && c.init?.method === "POST");
    expect(markCall?.url).toContain(NID);
    await act(async () => {
      markCall?.resolve({ id: NID, unread: 0 });
      deferredFetches()
        .find((c) => c.url.endsWith("/api/runtime/notifications") && c.init?.method !== "POST")
        ?.resolve({ unread: 0, items: [item(true)] });
    });
  });
});
