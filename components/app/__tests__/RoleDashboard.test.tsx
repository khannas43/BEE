import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleDashboard } from "@/components/app/demo/RoleDashboard";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const charts = [
  { kind: "donut", title: "By state", data: [{ label: "Active", value: 5 }, { label: "Revoked", value: 2 }] },
  { kind: "trend", title: "Issued, by month", data: [{ label: "2026-08", value: 1 }, { label: "2026-09", value: 3 }, { label: "2026-10", value: 2 }] },
];
const tile = (key: string, over: Record<string, unknown> = {}) => ({ key, label: `Tile ${key}`, value: 7, unit: "things", hint: "A hint.", tone: "attention", icon: "verified", columns: ["Registration ID", "Ledger"], rows: [["BEE/RAC/2025/90037", "Revoked"], ["BEE/RAC/2026/10101", "Active"]], note: null, href: "/app/demo/ledger", charts, total: 2, shown: 2, ...over });
const overview = (view: string) => ({ view, title: view === "director" ? "Programme at a glance" : "Auditor's dashboard", asOf: "2026-10-16T10:00:00Z", note: "n", range: { from: null, to: null }, tiles: [tile("a"), tile("b", { value: 0, rows: [], total: 0, shown: 0 })] });
const risk = tile("ai_risk", {
  label: "Highest compliance risk", icon: "warning", tone: "danger", columns: ["Manufacturer", "Score", "Risk band", "Why it is high", "Applications"], total: 1, shown: 1, value: 1,
  rows: [["Northwind Comforts (synthetic)", 99.5, "High", "62% of its applications were sent back", 6]],
  details: [[{ factor: "Returned share of applications", points: 18.6, weight: 20, reason: "62% of its applications were sent back (full weight at 50%)" }, { factor: "Fee confirmation delay (days)", points: 9.2, weight: 10, reason: "fees take 13 days to be confirmed (full weight at 14 days)" }]],
  charts: [{ kind: "donut", title: "Organisations by risk band", data: [{ label: "High", value: 1 }, { label: "Medium", value: 4 }, { label: "Low", value: 9 }] }],
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RoleDashboard", () => {
  it("shows the cards with live figures and charts, and when it was calculated in IST", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(overview("director"))));
    render(<RoleDashboard view="director" />);
    expect((await screen.findByTestId("dash-value-a")).textContent).toBe("7");
    expect(screen.getByRole("heading", { name: "Programme at a glance" })).toBeTruthy();
    expect(screen.getByTestId("dash-asof").textContent).toContain("2026-10-16 15:30 IST");
    expect(screen.getByTestId("dash-tile-a").querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("dash-tile-a").textContent).not.toContain("A hint.");
  });

  it("opens the records behind a card with charts, a link to the working screen and downloads, and closes it again", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return json(url.endsWith("/director") ? overview("director") : tile("a")); }));
    render(<RoleDashboard view="director" />);
    fireEvent.click(await screen.findByTestId("dash-tile-a"));
    expect((await screen.findByTestId("dash-drill-table")).textContent).toContain("BEE/RAC/2026/10101");
    expect(calls).toContain("/api/runtime/demo/dashboard/director/a");
    expect(screen.getByTestId("dash-open-screen").getAttribute("href")).toBe("/app/demo/ledger");
    expect(screen.getByTestId("dash-charts").querySelectorAll("svg").length).toBe(2);
    expect(screen.getByTestId("list-export")).toBeTruthy();
    expect(screen.getByTestId("list-export-xlsx")).toBeTruthy();
    fireEvent.change(screen.getByTestId("list-search"), { target: { value: "10101" } });
    await waitFor(() => expect(screen.getAllByTestId("dash-drill-row").length).toBe(1));
    fireEvent.click(screen.getByTestId("dash-tile-a"));
    await waitFor(() => expect(screen.queryByTestId("dash-drill")).toBeNull());
  });

  it("sends the chosen date range with every read, for the cards and for the open list", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return json(url.includes("/director/") ? tile("a") : overview("director")); }));
    render(<RoleDashboard view="director" />);
    await screen.findByTestId("dash-tile-a");
    expect(calls[0]).toBe("/api/runtime/demo/dashboard/director");
    fireEvent.change(screen.getByTestId("dash-range-from"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByTestId("dash-range-to"), { target: { value: "2026-03-31" } });
    await waitFor(() => expect(calls).toContain("/api/runtime/demo/dashboard/director?from=2026-01-01&to=2026-03-31"));
    fireEvent.click(await screen.findByTestId("dash-tile-a"));
    await waitFor(() => expect(calls).toContain("/api/runtime/demo/dashboard/director/a?from=2026-01-01&to=2026-03-31"));
    expect(screen.getByTestId("dash-drill-count").textContent).toContain("2026-01-01 to 2026-03-31");
    fireEvent.click(screen.getByTestId("dash-range-30"));
    await waitFor(() => expect(calls.some((c) => /^\/api\/runtime\/demo\/dashboard\/director\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/.test(c))).toBe(true));
    fireEvent.click(screen.getByTestId("dash-range-all"));
    await waitFor(() => expect(calls.filter((c) => c === "/api/runtime/demo/dashboard/director").length).toBeGreaterThan(1));
  });

  it("refuses a start date after the end date without asking the service", async () => {
    const fetchMock = vi.fn(async () => json(overview("auditor")));
    vi.stubGlobal("fetch", fetchMock);
    render(<RoleDashboard view="auditor" />);
    await screen.findByTestId("dash-tile-a");
    const before = fetchMock.mock.calls.length;
    fireEvent.change(screen.getByTestId("dash-range-to"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByTestId("dash-range-from"), { target: { value: "2026-02-01" } });
    expect((await screen.findByRole("alert")).textContent).toContain("start date is after the end date");
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it("says why a risk is high: a reason in the row and the factors behind the score when it is opened", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => json(url.endsWith("/director") ? { ...overview("director"), tiles: [risk] } : risk)));
    render(<RoleDashboard view="director" />);
    fireEvent.click(await screen.findByTestId("dash-tile-ai_risk"));
    expect((await screen.findByTestId("dash-drill-table")).textContent).toContain("Risk band");
    expect(screen.getByTestId("dash-drill-table").textContent).not.toContain("Band Score");
    expect(screen.getByTestId("dash-drill-table").textContent).toContain("62% of its applications were sent back");
    expect(screen.queryByTestId("dash-why")).toBeNull();
    fireEvent.click(screen.getByTestId("dash-why-toggle"));
    const why = await screen.findByTestId("dash-why");
    expect(why.textContent).toContain("Why Northwind Comforts (synthetic) is in the high risk band");
    expect(screen.getAllByTestId("dash-why-factor").length).toBe(2);
    expect(why.textContent).toContain("+18.6 of 20");
    expect(why.textContent).toContain("Fees take 13 days to be confirmed");
  });

  it("says so when a card has nothing behind it, and shows a refusal as an alert", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/auditor") ? json(overview("auditor")) : json(tile("b", { rows: [], total: 0, shown: 0 })))));
    render(<RoleDashboard view="auditor" />);
    fireEvent.click(await screen.findByTestId("dash-tile-b"));
    expect(await screen.findByTestId("dash-drill-empty")).toBeTruthy();
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "role_not_permitted", message: "No." }, 403)));
    render(<RoleDashboard view="director" />);
    expect((await screen.findByRole("alert")).textContent?.length).toBeGreaterThan(0);
  });
});
