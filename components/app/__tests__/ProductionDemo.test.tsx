import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionDemo } from "@/components/app/demo/ProductionDemo";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProductionDemo", () => {
  it("says it is a local demonstration and lists submissions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ submissions: [{ id: "1", quarter: "2026-Q3", state: "submitted", organisationName: "Nova", rowCount: 9, totalUnits: 100, evidenceCount: 1 }], canCreate: true, canReview: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    render(<ProductionDemo />);
    await waitFor(() => expect(screen.getAllByText("2026-Q3").length).toBeGreaterThan(0));
    // the financial year is chosen and its four quarters are shown: the submitted one is a tile, the other three are greyed out
    expect(screen.getAllByText("Q2 (July to September)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No data yet").length).toBe(3);
    expect(screen.getByRole("button", { name: "Create submission" })).toBeTruthy();
  });
});
