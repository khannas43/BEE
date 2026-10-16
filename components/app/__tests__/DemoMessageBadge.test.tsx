import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoMessageBadge } from "@/components/app/notifications/DemoMessageBadge";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DemoMessageBadge", () => {
  it("shows nothing when the messages call fails", async () => {
    const fetch = vi.fn(async () => json({ error: "role_not_permitted" }, 403));
    vi.stubGlobal("fetch", fetch);
    render(<DemoMessageBadge />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId("demo-message-badge")).toBeNull();
  });

  it("shows the unread count and links to the simulated inbox", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ unread: 3, items: [] })));
    render(<DemoMessageBadge />);
    expect((await screen.findByTestId("demo-message-badge-count")).textContent).toBe("3");
    expect(screen.getByTestId("demo-message-badge").getAttribute("href")).toBe("/app/demo/notifications");
    expect(screen.getByTestId("demo-message-badge").getAttribute("aria-label")).toBe("Simulated email and SMS messages, 3 unread");
  });

  it('shows "9+" when more than nine are unread', async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ unread: 12, items: [] })));
    render(<DemoMessageBadge />);
    expect((await screen.findByTestId("demo-message-badge-count")).textContent).toBe("9+");
    expect(screen.getByTestId("demo-message-badge").getAttribute("aria-label")).toBe("Simulated email and SMS messages, 12 unread");
  });
});
