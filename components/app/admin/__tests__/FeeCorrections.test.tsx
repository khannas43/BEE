import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeeCorrections } from "@/components/app/admin/FeeCorrections";
import { deferredFetches, installDeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div data-testid="screen-chrome">{children}</div>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => ({
    status: "signed-in" as const,
    me: { displayName: "BEE Finance", roles: [{ code: "finance", label: "Finance" }], organisations: [] },
  }),
  rolesText: () => "finance",
  orgsText: () => "",
}));

const APP = "3d6f0a8e-0000-4000-a000-0000000000a1";
const row = (over: Record<string, unknown>) => ({
  applicationId: APP, reference: "LOCAL-MA-0002", brandName: "Nova Cool", modelNumber: "NC-1", state: "iame_scrutiny", receiptReference: "UTR-WRONG", receivedOn: "2026-10-02",
  amountInr: "24000.00", confirmedBy: "BEE Finance", confirmedAt: "2026-10-03T10:00:00Z", correction: null, pendingProposalId: null, ...over,
});
const proposal = (over: Record<string, unknown>) => ({
  id: "p1", applicationId: APP, reference: "LOCAL-MA-0002", previousReceiptReference: "UTR-WRONG", previousReceivedOn: "2026-10-02", receiptReference: "UTR-RIGHT", receivedOn: "2026-10-01",
  reason: "The reference was mistyped", state: "pending", proposedBy: "BEE Programme", proposedByYou: false, proposedAt: "2026-10-04T10:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null, ...over,
});
const admin = (confirmations: unknown[], pending: unknown[]) => ({ today: "2026-10-04", confirmations, pending, decided: [] });

async function load(body: unknown, status = 200) {
  cleanup();
  render(<FeeCorrections module={"finance" as never} screen={"receipt" as never} />);
  await act(async () => {
    deferredFetches()[0].resolve(body, status);
  });
}

describe("FeeCorrections", () => {
  beforeEach(() => installDeferredFetch());

  it("shows each confirmation as first written, shows a correction beside it, and states that a confirmation is never edited", async () => {
    await load(admin([row({}), row({ applicationId: "b", reference: "LOCAL-MA-0003", correction: { receiptReference: "UTR-RIGHT", receivedOn: "2026-10-01", approvedBy: "BEE Programme", approvedAt: "2026-10-04T11:00:00Z" } })], []));
    expect(screen.getByTestId("corrections-receipt-LOCAL-MA-0002").textContent).toBe("UTR-WRONG");
    const corrected = screen.getByTestId("corrections-row-LOCAL-MA-0003");
    expect(corrected.getAttribute("data-corrected")).toBe("true");
    expect(screen.getByTestId("corrections-receipt-LOCAL-MA-0003").textContent).toBe("UTR-RIGHT");
    expect(corrected.textContent).toContain("first confirmed as UTR-WRONG");
    expect(screen.getByTestId("corrections-notes").textContent).toContain("never edited");
  });

  it("offers a correction only where none is waiting", async () => {
    await load(admin([row({}), row({ applicationId: "b", reference: "LOCAL-MA-0003", pendingProposalId: "p1" })], [proposal({})]));
    expect(screen.getByTestId("correction-propose-LOCAL-MA-0002")).toBeTruthy();
    expect(screen.queryByTestId("correction-propose-LOCAL-MA-0003")).toBeNull();
    expect(screen.getByTestId("corrections-pending-flag-LOCAL-MA-0003")).toBeTruthy();
  });

  it("offers approve and reject on a colleague's correction, and only withdraw on your own", async () => {
    await load(admin([row({})], [proposal({ id: "p1" }), proposal({ id: "p2", proposedByYou: true, proposedBy: "BEE Finance" })]));
    expect(screen.getByTestId("correction-approve-run-p1")).toBeTruthy();
    expect(screen.getByTestId("correction-reject-run-p1")).toBeTruthy();
    expect(screen.queryByTestId("correction-withdraw-run-p1")).toBeNull();
    expect(screen.getByTestId("correction-withdraw-run-p2")).toBeTruthy();
    expect(screen.queryByTestId("correction-approve-run-p2")).toBeNull();
    expect(screen.getByTestId("corrections-pending-p1").textContent).toContain("UTR-WRONG (2026-10-02) → UTR-RIGHT (2026-10-01)");
  });

  it("refuses an unchanged or incomplete correction on the screen and sends nothing", async () => {
    await load(admin([row({})], []));
    fireEvent.click(screen.getByTestId("correction-propose-LOCAL-MA-0002"));
    const before = deferredFetches().length;
    fireEvent.change(screen.getByTestId("correction-reason"), { target: { value: "no change" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("correction-propose-run"));
    });
    expect(screen.getByTestId("correction-propose-input-error")).toBeTruthy();
    expect(deferredFetches().length).toBe(before);
  });

  it("sends a correction with the application and shows that a different person must approve it", async () => {
    await load(admin([row({})], []));
    fireEvent.click(screen.getByTestId("correction-propose-LOCAL-MA-0002"));
    fireEvent.change(screen.getByTestId("correction-receipt"), { target: { value: "UTR-RIGHT" } });
    fireEvent.change(screen.getByTestId("correction-date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByTestId("correction-reason"), { target: { value: "The reference was mistyped" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("correction-propose-run"));
    });
    const call = deferredFetches().find((c) => c.url.endsWith("/api/runtime/fee-corrections/proposals"))!;
    expect(JSON.parse(String(call.init?.body))).toEqual({ applicationId: APP, receiptReference: "UTR-RIGHT", receivedOn: "2026-10-01", reason: "The reference was mistyped" });
    await act(async () => {
      call.resolve(proposal({ proposedByYou: true, proposedBy: "BEE Finance" }), 201);
    });
    expect(screen.getByTestId("correction-propose-success").textContent).toContain("different person must approve");
  });

  it("shows the refusal when a person who may not read the confirmations opens the screen", async () => {
    await load({ error: "role_not_permitted", message: "This role cannot perform this action." }, 403);
    expect(screen.getByTestId("corrections-error")).toBeTruthy();
    expect(screen.queryByTestId("correction-form")).toBeNull();
  });
});
