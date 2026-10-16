import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagesDemo } from "@/components/app/demo/MessagesDemo";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const msg = (over: Record<string, unknown>) => ({ id: "m1", channel: "email", address: "bee.finance@bee-demo.invalid", kind: "payment_to_confirm", reference: "DEMO-PAY-0001", subject: "Payment to confirm: DEMO-PAY-0001", body: "INR 11800.00 received.", createdAt: "2026-10-16T10:00:00Z", read: false, ...over });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MessagesDemo", () => {
  it("shows email and SMS, says nothing is sent, and marks one read", async () => {
    const calls: string[] = [];
    let read = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      if (init?.method === "POST") { read = true; return json({ marked: 1 }); }
      return json({ unread: read ? 1 : 2, note: "n", items: [msg({}), msg({ id: "m2", channel: "sms", subject: null, address: "+91 9XXXXX0001 (synthetic)", body: "BEE demo: payment received.", read })] });
    }));
    render(<MessagesDemo />);
    expect((await screen.findAllByTestId("message")).length).toBe(2);
    expect(screen.getByRole("note").textContent).toMatch(/no email or text message is sent/i);
    expect(screen.getByTestId("messages-unread").textContent).toBe("2 unread");
    fireEvent.click(screen.getByRole("button", { name: /Mark as read: Payment to confirm/ }));
    await waitFor(() => expect(screen.getByTestId("messages-unread").textContent).toBe("1 unread"));
    expect(calls).toContain("POST /api/runtime/demo/messages/m1/read");
  });

  it("asks for one channel when a filter is chosen and shows an empty inbox kindly", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return json({ unread: 0, items: [], note: "n" }); }));
    render(<MessagesDemo />);
    expect(await screen.findByTestId("messages-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("messages-filter-sms"));
    await waitFor(() => expect(calls).toContain("/api/runtime/demo/messages?channel=sms"));
  });

  it("shows a refusal as an alert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "role_not_permitted" }, 403)));
    render(<MessagesDemo />);
    expect((await screen.findByRole("alert")).textContent?.length).toBeGreaterThan(0);
  });
});
