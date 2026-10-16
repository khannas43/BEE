import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QrDemo, verifyHref } from "@/components/app/demo/QrDemo";

const batch = {
  id: "b1", reference: "LOCAL-MA-S2-01", brandName: "Nova Cool", modelNumber: "NC-RAC-S2A", organisation: "Nova", registrationId: "BEE/RAC/2026/10901",
  quantity: 100, status: "open", createdAt: "2026-10-05T00:00:00Z", allocated: 15, bound: 25, void: 0, remaining: 60,
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("QrDemo", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the simulated note, the batches with counts, and a verify link for a serial", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes("/qr/b1")) {
        return json(200, { ...batch, total: 1, offset: 0, limit: 25, serials: [{ serial: "BEEQ-S2D0000001", state: "bound", allocatedAt: "x", boundAt: "y", voidedAt: null, voidReason: null }], demonstration: true });
      }
      return json(200, { canWrite: true, items: [batch], eligible: [], demonstration: true });
    });
    vi.stubGlobal("fetch", f);
    render(<QrDemo />);
    await waitFor(() => expect(screen.getAllByTestId("qr-batch-row")).toHaveLength(1));
    await userEvent.click(screen.getByTestId("qr-open"));
    await waitFor(() => expect(screen.getByTestId("qr-serial-row")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Verify this serial" }).getAttribute("href")).toBe("/verify?reg=BEEQ-S2D0000001");
    expect(verifyHref("BEEQ-S2D0000001")).toBe("/verify?reg=BEEQ-S2D0000001");
  });

  it("shows Spring's refusal detail as an alert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { error: "role_not_permitted", detail: "Not for your role" })));
    render(<QrDemo />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Not for your role"));
  });
});
