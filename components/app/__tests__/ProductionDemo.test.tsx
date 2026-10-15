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
    expect(screen.getByTestId("prod-note").textContent).toContain("not a BEE system");
    await waitFor(() => expect(screen.getByText("2026-Q3")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Create submission" })).toBeTruthy();
  });
});
