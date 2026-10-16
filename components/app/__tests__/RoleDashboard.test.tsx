import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleDashboard } from "@/components/app/demo/RoleDashboard";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const tile = (key: string, over: Record<string, unknown> = {}) => ({ key, label: `Tile ${key}`, value: 3, unit: "things", hint: "A hint.", tone: "attention", columns: ["Registration ID", "Ledger"], rows: [["BEE/RAC/2025/90037", "Revoked"]], note: null, href: "/app/demo/ledger", ...over });
const overview = (view: string) => ({ view, title: view === "director" ? "Director's dashboard" : "Auditor's dashboard", asOf: "2026-10-16T10:00:00Z", note: "n", tiles: [tile("a"), tile("b", { value: 0, rows: [] })] });
const drill = { view: "director", key: "a", label: "Tile a", hint: "A hint.", columns: ["Registration ID", "Ledger"], rows: [["BEE/RAC/2025/90037", "Revoked"], ["BEE/RAC/2026/10101", "Active"]], total: 2, shown: 2, note: null, href: "/app/demo/ledger", asOf: "2026-10-16T10:00:00Z" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RoleDashboard", () => {
  it("shows the tiles with their live figures and says when it was calculated, in IST", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(overview("director"))));
    render(<RoleDashboard view="director" />);
    expect((await screen.findByTestId("dash-value-a")).textContent).toBe("3");
    expect(screen.getByRole("heading", { name: "Director's dashboard" })).toBeTruthy();
    expect(screen.getByText(/As of 2026-10-16 15:30 IST/)).toBeTruthy();
    expect(screen.getByTestId("dash-tile-a").textContent).toContain("BEE/RAC/2025/90037");
  });

  it("opens the list behind a figure, with a link to the working screen and downloads, and closes it again", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return json(url.endsWith("/director") ? overview("director") : drill); }));
    render(<RoleDashboard view="director" />);
    fireEvent.click(await screen.findByTestId("dash-tile-a"));
    expect((await screen.findByTestId("dash-drill-table")).textContent).toContain("BEE/RAC/2026/10101");
    expect(calls).toContain("/api/runtime/demo/dashboard/director/a");
    expect(screen.getByTestId("dash-open-screen").getAttribute("href")).toBe("/app/demo/ledger");
    expect(screen.getByTestId("list-export")).toBeTruthy();
    expect(screen.getByTestId("list-export-xlsx")).toBeTruthy();
    fireEvent.change(screen.getByTestId("list-search"), { target: { value: "10101" } });
    await waitFor(() => expect(screen.getAllByTestId("dash-drill-row").length).toBe(1));
    fireEvent.click(screen.getByTestId("dash-tile-a"));
    await waitFor(() => expect(screen.queryByTestId("dash-drill")).toBeNull());
  });

  it("says so when a figure has nothing behind it, and shows a refusal as an alert", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/auditor") ? json(overview("auditor")) : json({ ...drill, rows: [], total: 0, shown: 0 }))));
    render(<RoleDashboard view="auditor" />);
    fireEvent.click(await screen.findByTestId("dash-tile-b"));
    expect(await screen.findByTestId("dash-drill-empty")).toBeTruthy();
    cleanup();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "role_not_permitted", message: "No." }, 403)));
    render(<RoleDashboard view="director" />);
    expect((await screen.findByRole("alert")).textContent?.length).toBeGreaterThan(0);
  });
});
