import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MisDemo } from "@/components/app/demo/MisDemo";

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const summary = {
  panel: "summary",
  asOf: "2026-10-15T10:00:00Z",
  dataVersion: "abc123def456",
  sources: ["model_application"],
  from: "2025-11-01",
  to: "2026-10-15",
  cards: [{ key: "submitted", label: "Applications submitted", value: 40, unit: null, note: null }],
  tables: [{ key: "by_state", title: "Model applications by state", chart: "bar", columns: ["State", "Applications"], rows: [["approved", 20], ["fee_due", 3]] }],
  unavailable: [{ part: "Quarterly production", reason: "The production tables are not in this database." }],
  demonstration: true,
};

afterEach(() => cleanup());

describe("MisDemo", () => {
  it("shows cards, a chart with its table, the as-of line and a not-available part", async () => {
    vi.stubGlobal("fetch", vi.fn((url: string) => (url.endsWith("/mis") ? json({ panels: ["summary", "applications"] }) : json(summary))));
    render(<MisDemo />);
    await waitFor(() => expect(screen.getByTestId("mis-card-submitted")).toBeTruthy());
    expect(screen.getByTestId("mis-asof").textContent).toContain("abc123def456");
    expect(screen.getByTestId("mis-table-by_state").textContent).toContain("approved");
    expect(screen.getByTestId("mis-unavailable").textContent).toContain("not available yet");
  });

  it("shows a refusal as an alert", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ error: "role_not_permitted" }, 403)));
    render(<MisDemo />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});
