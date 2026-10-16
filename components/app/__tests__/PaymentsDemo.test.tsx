import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentsDemo } from "@/components/app/demo/PaymentsDemo";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PaymentsDemo", () => {
  it("lets the applicant start a payment and says what is simulated", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      if (init?.method === "POST") return json({ id: "p1", gatewayRef: "SIMGW-AAAA0001", amountInr: "11800.00" }, 201);
      return json({
        view: "applicant",
        payments: [],
        feeDue: [{ applicationId: "a1", reference: "DEMO-PAY-0001", brandName: "Nova Cool", modelNumber: "X", feeInr: "10000.00", taxRatePercent: "18.00", taxInr: "1800.00", totalInr: "11800.00" }],
      });
    }));
    render(<PaymentsDemo />);
    fireEvent.click(await screen.findByRole("button", { name: /Pay at simulated gateway for DEMO-PAY-0001/ }));
    await waitFor(() => expect(screen.getByTestId("pay-status").textContent).toContain("SIMGW-AAAA0001"));
    expect(calls).toContain("POST /api/runtime/demo/payments");
  });

  it("shows Finance the reconciliation and a refusal as an alert", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/reconciliation")) {
        return json({ byStatus: [{ status: "paid", count: 1, totalInr: "11800.00" }], paidTotalInr: "11800.00", confirmedReceiptsTotalInr: "0.00", confirmedReceiptsCount: 0,
          confirmedWithoutSimulatedPayment: 0, confirmedWithoutSimulatedPaymentInr: "0.00", differences: [{ kind: "paid_not_yet_confirmed", paymentId: "p", applicationReference: "DEMO-PAY-0002", gatewayRef: "SIMGW-5EED0002", paidInr: "11800.00", confirmedInr: null }], receipts: [], note: "" });
      }
      return json({ view: "finance", payments: [{ id: "p", applicationId: "a", applicationReference: "DEMO-PAY-0002", organisationCode: "NOVA", amountInr: "11800.00", status: "paid", gatewayRef: "SIMGW-5EED0002", receiptNumber: "SIMRCPT-1", feeConfirmed: false }] });
    }));
    render(<PaymentsDemo />);
    expect((await screen.findByTestId("pay-reconciliation")).textContent).toContain("paid INR 11800.00 but not yet confirmed by Finance");
    expect((screen.getByTestId("pay-list")).textContent).toContain("SIMGW-5EED0002");
  });

  it("shows an alert when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "role_not_permitted", message: "No." }, 403)));
    render(<PaymentsDemo />);
    expect((await screen.findByRole("alert")).textContent).toBeTruthy();
  });
});
