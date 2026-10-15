import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LedgerDemo } from "@/components/app/demo/LedgerDemo";

const tx = (over: object = {}) => ({
  id: "t1", certificateId: "c1", registrationId: "BEE/RAC/2026/10001", blockNo: 7, seq: 1, attempt: 1, kind: "issue", state: "pending",
  prevHash: "0".repeat(64), hash: "a".repeat(64), validTo: "2029-09-30", reason: null, failureReason: null, submittedBy: "BEE Secretary", decidedBy: null,
  seededNote: null, createdAt: "2026-10-15T10:00:00Z", committedAt: null, ...over,
});
const row = { certificateId: "c1", registrationId: "BEE/RAC/2026/10001", manufacturer: "Nova", brandName: "Nova Cool", modelNumber: "X", validTo: "2029-09-30", ledgerValidTo: "2029-09-30", ledgerStatus: "pending", pendingKind: "issue", lastTx: tx() };
const detail = { ...row, stars: 4, validFrom: "2026-10-01", transactions: [tx()], events: [], verification: { result: "MISMATCH", firstBadSeq: 1, detail: "stored hash differs", transactions: 1 },
  actions: [{ action: "commit", allowed: false, why: "You submitted this transaction; a second person must commit or fail it." }] };

function mockFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = url.endsWith("/transactions") ? { transactions: [tx()] } : url.endsWith("/c1") ? detail : { certificates: [row], readOnly: false };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("LedgerDemo", () => {
  it("shows the simulated notice, the chain verification result and the segregation reason", async () => {
    mockFetch();
    render(<LedgerDemo />);
    expect(screen.getByTestId("ledger-notice").textContent).toMatch(/not Hyperledger Fabric/);
    await waitFor(() => expect(screen.getByTestId("ledger-certs")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Open ledger panel for BEE\/RAC\/2026\/10001/ }));
    await waitFor(() => expect(screen.getByTestId("ledger-verify").textContent).toMatch(/MISMATCH/));
    expect((screen.getByTestId("ledger-action-commit") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/a second person must commit or fail it/)).toBeTruthy();
    expect(screen.getByTestId("ledger-explorer")).toBeTruthy();
  });
});
