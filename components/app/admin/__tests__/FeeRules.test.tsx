import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeeRules } from "@/components/app/admin/FeeRules";
import { deferredFetches, installDeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div data-testid="screen-chrome">{children}</div>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => ({
    status: "signed-in" as const,
    me: { displayName: "BEE Admin", roles: [{ code: "admin", label: "Administrator" }], organisations: [] },
  }),
  rolesText: () => "admin",
  orgsText: () => "",
}));

const proposal = (over: Record<string, unknown>) => ({
  id: "p1", ruleKey: "RAC:new_model", categoryCode: "RAC", applicationType: "new_model", amountInr: "26000.00", taxRatePercent: "18.00", effectiveFrom: "2026-10-14",
  sourceReference: "Circular 2026/14", reason: "Revised fee", state: "pending", proposedBy: "BEE Finance", proposedByYou: false, proposedAt: "2026-10-04T10:00:00Z",
  decidedBy: null, decidedAt: null, decisionNote: null, appliedVersion: null, ...over,
});
const admin = (pending: unknown[]) => ({
  today: "2026-10-04",
  applicationTypes: [{ code: "new_model", label: "New model" }],
  categories: [{ code: "RAC", name: "Room air conditioner" }],
  rules: [{
    ruleKey: "RAC:new_model", categoryCode: "RAC", applicationType: "new_model",
    versions: [{ version: 2, effectiveFrom: "2026-10-01", effectiveTo: null, amountInr: "24000.00", taxRatePercent: "0.00", verification: "provisional", source: "Local seed", inForce: true }],
  }],
  pending,
  decided: [],
});

async function load(body: unknown, status = 200) {
  cleanup();
  render(<FeeRules module={"administration" as never} screen={"fee-rules" as never} />);
  await act(async () => {
    deferredFetches()[0].resolve(body, status);
  });
}

describe("FeeRules", () => {
  beforeEach(() => installDeferredFetch());

  it("shows each rule version with its dates, fee and the separate tax line, and the standing notes", async () => {
    await load(admin([]));
    const row = screen.getByTestId("feerules-version-RAC:new_model-2");
    expect(row.textContent).toContain("2026-10-01");
    expect(row.textContent).toContain("₹24,000.00");
    expect(row.textContent).toContain("not set");
    expect(row.getAttribute("data-in-force")).toBe("true");
    expect(screen.getByTestId("feerules-notes").textContent).toContain("Tax is a separate line");
    expect(screen.getByTestId("feerules-pending-empty")).toBeTruthy();
  });

  it("offers approve and reject on a colleague's proposal, and only withdraw on your own", async () => {
    await load(admin([proposal({ id: "p1" }), proposal({ id: "p2", proposedByYou: true, proposedBy: "BEE Admin" })]));
    expect(screen.getByTestId("feerule-approve-run-p1")).toBeTruthy();
    expect(screen.getByTestId("feerule-reject-run-p1")).toBeTruthy();
    expect(screen.queryByTestId("feerule-withdraw-run-p1")).toBeNull();
    expect(screen.getByTestId("feerule-withdraw-run-p2")).toBeTruthy();
    expect(screen.queryByTestId("feerule-approve-run-p2")).toBeNull();
  });

  it("refuses an incomplete proposal on the screen and sends nothing", async () => {
    await load(admin([]));
    const before = deferredFetches().length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("feerule-propose-run"));
    });
    expect(screen.getByTestId("feerule-propose-input-error")).toBeTruthy();
    expect(deferredFetches().length).toBe(before);
  });

  it("sends a complete proposal and shows that a different person must approve it", async () => {
    await load(admin([]));
    fireEvent.change(screen.getByTestId("feerule-amount"), { target: { value: "26000.00" } });
    fireEvent.change(screen.getByTestId("feerule-tax"), { target: { value: "18" } });
    fireEvent.change(screen.getByTestId("feerule-from"), { target: { value: "2026-10-14" } });
    fireEvent.change(screen.getByTestId("feerule-source"), { target: { value: "Circular 2026/14" } });
    fireEvent.change(screen.getByTestId("feerule-reason"), { target: { value: "Revised fee" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("feerule-propose-run"));
    });
    const call = deferredFetches().find((c) => c.url.endsWith("/api/runtime/fee-rules/proposals"))!;
    expect(JSON.parse(String(call.init?.body))).toMatchObject({ categoryCode: "RAC", applicationType: "new_model", amountInr: "26000.00", taxRatePercent: "18", effectiveFrom: "2026-10-14" });
    await act(async () => {
      call.resolve(proposal({ proposedByYou: true, proposedBy: "BEE Admin" }), 201);
    });
    expect(screen.getByTestId("feerule-propose-success").textContent).toContain("different person must approve");
  });

  it("shows the refusal when a person who may not read fee rules opens the screen", async () => {
    await load({ error: "role_not_permitted", message: "This role cannot perform this action." }, 403);
    expect(screen.getByTestId("feerules-error")).toBeTruthy();
    expect(screen.queryByTestId("feerule-propose")).toBeNull();
  });
});
