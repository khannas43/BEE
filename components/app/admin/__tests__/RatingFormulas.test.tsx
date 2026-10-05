import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RatingFormulas } from "@/components/app/admin/RatingFormulas";
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
  id: "p1", categoryCode: "RAC", effectiveFrom: "2026-10-14", minIseer: ["3.00", "3.40", "3.90", "4.40", "4.90"], sourceReference: "Circular 2026/14", reason: "Revised scheme",
  state: "pending", proposedBy: "BEE Finance", proposedByYou: false, proposedAt: "2026-10-04T10:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null, appliedScheme: null, ...over,
});
const admin = (pending: unknown[]) => ({
  today: "2026-10-04",
  categories: [{ code: "RAC", name: "Room air conditioner" }],
  schemes: [{
    schemeKey: "RAC-ISEER-DEMO-1", categoryCode: "RAC", effectiveFrom: "2026-01-01", source: "Local seed", inForce: true,
    bands: ["3.30", "3.50", "4.00", "4.50", "5.00"].map((m, i) => ({ stars: i + 1, minIseer: m })),
  }],
  pending,
  decided: [],
});

async function load(body: unknown, status = 200) {
  cleanup();
  render(<RatingFormulas module={"administration" as never} screen={"rating-formula" as never} />);
  await act(async () => {
    deferredFetches()[0].resolve(body, status);
  });
}

describe("RatingFormulas", () => {
  beforeEach(() => installDeferredFetch());

  it("shows each scheme with its start date, status and the figure for every star, and says it is a demonstration", async () => {
    await load(admin([]));
    const row = screen.getByTestId("schemes-row-RAC-ISEER-DEMO-1");
    expect(row.textContent).toContain("2026-01-01");
    expect(row.textContent).toContain("In force");
    expect(row.textContent).toContain("1★ 3.30");
    expect(row.textContent).toContain("5★ 5.00");
    expect(screen.getByTestId("schemes-notes").textContent).toContain("BEE-approved formula");
    expect(screen.getByTestId("schemes-pending-empty")).toBeTruthy();
  });

  it("offers approve and reject on a colleague's proposal, and only withdraw on your own", async () => {
    await load(admin([proposal({ id: "p1" }), proposal({ id: "p2", proposedByYou: true, proposedBy: "BEE Admin" })]));
    expect(screen.getByTestId("scheme-approve-run-p1")).toBeTruthy();
    expect(screen.getByTestId("scheme-reject-run-p1")).toBeTruthy();
    expect(screen.queryByTestId("scheme-withdraw-run-p1")).toBeNull();
    expect(screen.getByTestId("scheme-withdraw-run-p2")).toBeTruthy();
    expect(screen.queryByTestId("scheme-approve-run-p2")).toBeNull();
  });

  it("refuses figures that do not rise on the screen and sends nothing", async () => {
    await load(admin([]));
    const before = deferredFetches().length;
    for (const [i, v] of ["3.00", "3.00", "3.90", "4.40", "4.90"].entries()) fireEvent.change(screen.getByTestId(`scheme-min-${i + 1}`), { target: { value: v } });
    fireEvent.change(screen.getByTestId("scheme-source"), { target: { value: "s" } });
    fireEvent.change(screen.getByTestId("scheme-reason"), { target: { value: "r" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("scheme-propose-run"));
    });
    expect(screen.getByTestId("scheme-propose-input-error")).toBeTruthy();
    expect(deferredFetches().length).toBe(before);
  });

  it("sends a complete proposal and shows that a different person must approve it", async () => {
    await load(admin([]));
    for (const [i, v] of ["3.00", "3.40", "3.90", "4.40", "4.90"].entries()) fireEvent.change(screen.getByTestId(`scheme-min-${i + 1}`), { target: { value: v } });
    fireEvent.change(screen.getByTestId("scheme-from"), { target: { value: "2026-10-14" } });
    fireEvent.change(screen.getByTestId("scheme-source"), { target: { value: "Circular 2026/14" } });
    fireEvent.change(screen.getByTestId("scheme-reason"), { target: { value: "Revised scheme" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("scheme-propose-run"));
    });
    const call = deferredFetches().find((c) => c.url.endsWith("/api/runtime/rating-schemes/proposals"))!;
    expect(JSON.parse(String(call.init?.body))).toMatchObject({ categoryCode: "RAC", effectiveFrom: "2026-10-14", minIseer: ["3.00", "3.40", "3.90", "4.40", "4.90"] });
    await act(async () => {
      call.resolve(proposal({ proposedByYou: true, proposedBy: "BEE Admin" }), 201);
    });
    expect(screen.getByTestId("scheme-propose-success").textContent).toContain("different person must approve");
  });

  it("shows the refusal when a person who may not read the schemes opens the screen", async () => {
    await load({ error: "role_not_permitted", message: "This role cannot perform this action." }, 403);
    expect(screen.getByTestId("schemes-error")).toBeTruthy();
    expect(screen.queryByTestId("scheme-propose")).toBeNull();
  });
});
