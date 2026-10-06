import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import VerifyPage from "@/app/(public)/verify/page";

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

const CERT = {
  registrationId: "BEE/RAC/2026/10001", manufacturer: "Nova Appliances Pvt Ltd", brandName: "Nova Cool", modelNumber: "NC-1", category: "RAC", stars: 4,
  verifiedIseer: "4.62", validFrom: "2026-10-06", validTo: "2029-10-05", status: "valid", localDemoCertificate: true,
};
const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the public verification page", () => {
  it("asks nothing until a registration ID is given", () => {
    search = "";
    const f = reply(200, CERT);
    vi.stubGlobal("fetch", f);
    render(<VerifyPage />);
    expect(f).not.toHaveBeenCalled();
    expect(screen.queryByTestId("verify-result")).toBeNull();
  });

  it("shows a valid registration with the demonstration notice, without credentials", async () => {
    search = "reg=BEE%2FRAC%2F2026%2F10001";
    const f = reply(200, CERT);
    vi.stubGlobal("fetch", f);
    render(<VerifyPage />);
    await waitFor(() => expect(screen.getByTestId("verify-result").getAttribute("data-outcome")).toBe("valid"));
    expect(f.mock.calls[0][0]).toBe("/api/runtime/verification?reg=BEE%2FRAC%2F2026%2F10001");
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: "omit" });
    expect(screen.getByTestId("verify-manufacturer").textContent).toBe("Nova Appliances Pvt Ltd");
    expect(screen.getByTestId("verify-validity").textContent).toBe("2026-10-06 to 2029-10-05");
    expect(screen.getByTestId("verify-demo").textContent).toMatch(/not a BEE certificate/);
  });

  it("shows an expired registration as expired", async () => {
    search = "reg=BEE%2FRAC%2F2020%2F10001";
    vi.stubGlobal("fetch", reply(200, { ...CERT, status: "expired" }));
    render(<VerifyPage />);
    await waitFor(() => expect(screen.getByTestId("verify-status").textContent).toBe("Expired registration"));
  });

  it("says not found, and unavailable, in plain words", async () => {
    search = "reg=BEE%2FRAC%2F2026%2F99999";
    vi.stubGlobal("fetch", reply(404, { error: "not_found" }));
    render(<VerifyPage />);
    await waitFor(() => expect(screen.getByTestId("verify-result").getAttribute("data-outcome")).toBe("not_found"));
    cleanup();
    vi.stubGlobal("fetch", reply(503, { error: "unavailable" }));
    render(<VerifyPage />);
    await waitFor(() => expect(screen.getByTestId("verify-result").getAttribute("data-outcome")).toBe("unavailable"));
  });

  it("asks a person who checks too often to wait, with the wait the server gave", async () => {
    search = "reg=BEE%2FRAC%2F2026%2F10001";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "Retry-After": "42" } })));
    render(<VerifyPage />);
    await waitFor(() => expect(screen.getByTestId("verify-result").getAttribute("data-outcome")).toBe("rate_limited"));
    expect(screen.getByTestId("verify-message").textContent).toMatch(/Too many checks just now.*about 42 seconds/);
    cleanup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "Retry-After": "junk" } })));
    render(<VerifyPage />);
    await waitFor(() => expect(screen.getByTestId("verify-result").getAttribute("data-outcome")).toBe("rate_limited"));
    expect(screen.getByTestId("verify-message").textContent).not.toMatch(/seconds/);
  });
});
