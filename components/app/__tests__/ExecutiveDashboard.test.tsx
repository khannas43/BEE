import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutiveDashboard } from "@/components/app/demo/ExecutiveDashboard";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const kpi = (key: string, value: number | null, unit = "") => ({ key, label: `K ${key}`, value, unit, hint: "A hint.", tone: "good", icon: "verified" });
const body = (org: string | null) => ({
  asOf: "2026-10-16T10:00:00Z", range: { from: "", to: "" }, organisation: org, note: "n",
  organisations: [{ id: "o1", name: "Nova Cool" }, { id: "o2", name: "Pixel" }],
  kpis: [kpi("received", 20), kpi("issued", org ? 3 : 9), kpi("approval_rate", 91.3, "%"), kpi("fees", 2941000, "INR"), kpi("avg_days", null, "days")],
  charts: [
    { key: "flow", kind: "multi", title: "Flow", aName: "Received", bName: "Issued", data: [{ label: "2026-09", a: 3, b: 1 }, { label: "2026-10", a: 5, b: 2 }] },
    { key: "pipeline", kind: "bars", title: "Pipeline", data: [{ label: "iame_scrutiny", value: 4 }] },
    { key: "ledger", kind: "donut", title: "Ledger", data: [{ label: "Active", value: 5 }, { label: "Revoked", value: 1 }] },
    { key: "fees", kind: "trend", title: "Fees", data: [{ label: "2026-09", value: 10 }, { label: "2026-10", value: 30 }] },
    { key: "manufacturers", kind: "bars", title: "By manufacturer", data: [{ label: "Nova Cool", value: 9 }, { label: "Pixel", value: 2 }] },
  ],
  waitingList: [{ reference: "DEMO-1", model: "Nova X", manufacturer: "Nova Cool", stage: "iame_scrutiny", days: 12 }],
  riskList: [{ name: "Nova Cool", score: 40, band: "medium", applications: 5 }],
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ExecutiveDashboard", () => {
  it("shows the headline figures, the charts and the two lists from one call", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(body(null))));
    render(<ExecutiveDashboard />);
    expect((await screen.findByTestId("exec-kpi-issued-value")).textContent).toBe("9");
    expect(screen.getByTestId("exec-kpi-approval_rate-value").textContent).toBe("91.3%");
    expect(screen.getByTestId("exec-kpi-fees-value").textContent).toContain("₹29.41 L");
    expect(screen.getByTestId("exec-kpi-avg_days-value").textContent).toContain("n/a");
    expect(screen.getByTestId("exec-chart-flow").querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("exec-chart-pipeline").textContent).toContain("Iame scrutiny".replace("Iame", "IAME"));
    expect(screen.getByTestId("exec-waiting").textContent).toContain("DEMO-1");
    expect(screen.getByTestId("exec-risk").textContent).toContain("Nova Cool");
  });

  it("narrows everything to one manufacturer when its bar is clicked, and Reset widens it again", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return json(body(url.includes("organisation=o1") ? "o1" : null)); }));
    render(<ExecutiveDashboard />);
    await screen.findByTestId("exec-kpi-issued-value");
    fireEvent.click(screen.getAllByTestId("exec-pick")[0]);
    await waitFor(() => expect(screen.getByTestId("exec-kpi-issued-value").textContent).toBe("3"));
    expect(calls.some((u) => u.includes("organisation=o1"))).toBe(true);
    expect(screen.getByTestId("exec-org-note").textContent).toContain("Nova Cool");
    fireEvent.click(screen.getByTestId("exec-reset"));
    await waitFor(() => expect(screen.getByTestId("exec-kpi-issued-value").textContent).toBe("9"));
  });

  it("passes the chosen dates and refuses a start after the end without asking the service", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return json(body(null)); }));
    render(<ExecutiveDashboard />);
    await screen.findByTestId("exec-kpi-issued-value");
    fireEvent.change(screen.getByTestId("exec-from"), { target: { value: "2026-09-01" } });
    await waitFor(() => expect(calls.some((u) => u.includes("from=2026-09-01"))).toBe(true));
    const before = calls.length;
    fireEvent.change(screen.getByTestId("exec-to"), { target: { value: "2026-08-01" } });
    expect((await screen.findByRole("alert")).textContent).toContain("start date is after the end date");
    expect(calls.length).toBe(before);
  });
});
