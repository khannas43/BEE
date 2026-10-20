import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Manufacturer360Demo } from "@/components/app/demo/Manufacturer360Demo";
import type { ManufacturerProfile } from "@/lib/client/runtimeManufacturers";
import { runtimeNavFor, runtimeRouteFor } from "@/lib/runtimeRoutes";

const search = vi.hoisted(() => ({ value: "" }));

afterEach(() => cleanup());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/app/demo/manufacturer-360",
  useSearchParams: () => new URLSearchParams(search.value),
}));
const profile = (over: Partial<ManufacturerProfile>): ManufacturerProfile => ({
  id: "o1", code: "NOVA", name: "Nova Cool Appliances Pvt Ltd", status: "Compliant", state: "Delhi", city: "New Delhi", categories: ["RAC"], since: "12 Mar 2024",
  permitteeNumber: "PT-2024-00117", applicationId: null, applicationReference: null, cin: "U29300DL2012PLC231045", gstin: "07AABCN4410K1ZP", address: "Okhla, New Delhi",
  signatory: { name: "Meera Sethi", designation: "MD", email: "m@x.example", phone: "98101 22034" }, facilities: [], brands: [], models: [],
  fees: { paid: 177000, outstanding: 11800, payments: [] }, qr: { issued: 1240, bound: 892, unused: 348 }, production: [], documents: [], observation: null,
  anomalies: [], flags: [], timeline: [], ...over,
});
const LIST = [
  profile({}),
  profile({ id: "o2", code: "SYNTH-MFG-4", name: "Harbor Breeze Cooling Pvt Ltd", status: "Suspended", city: "Chennai", state: "Tamil Nadu",
    brands: [{ id: "b1", name: "Breezo Home (synthetic)", status: "suspended", reason: "Ownership of the brand name is disputed.", changedOn: null, registeredOn: null, authorisations: 0 }] }),
  profile({ id: "o3", code: "SYNTH-MFG-6", name: "Cinder Peak Cooling Pvt Ltd", status: "On hold", city: "Hyderabad", state: "Telangana" }),
];
vi.mock("@/lib/client/runtimeManufacturers", async (orig) => ({
  ...(await orig<typeof import("@/lib/client/runtimeManufacturers")>()),
  useManufacturers: () => ({ phase: "ready", list: LIST }),
}));

describe("Manufacturer360Demo", () => {
  it("lists every manufacturer and filters by search and status", () => {
    search.value = "";
    render(<Manufacturer360Demo />);
    expect(screen.getByTestId("m360-count").textContent).toContain("3 of 3");
    fireEvent.change(screen.getByTestId("m360-search"), { target: { value: "chennai" } });
    expect(screen.getByTestId("m360-count").textContent).toContain("1 of 3");
    fireEvent.change(screen.getByTestId("m360-search"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("m360-filter-status"), { target: { value: "Suspended" } });
    expect(screen.getByTestId("m360-row-SYNTH-MFG-4")).toBeTruthy();
    expect(screen.queryByTestId("m360-row-NOVA")).toBeNull();
  });

  it("shows a profile with collapsible sections and the reason for a suspended brand", () => {
    search.value = "m=SYNTH-MFG-4";
    render(<Manufacturer360Demo />);
    expect(screen.getByTestId("m360-header").textContent).toContain("Harbor Breeze Cooling Pvt Ltd");
    const toggle = screen.getByTestId("m360-section-brands-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("m360-brand-reason-b1").textContent).toContain("Ownership of the brand name is disputed.");
    fireEvent.click(screen.getByTestId("m360-collapse-all"));
    expect(screen.getByTestId("m360-section-company-toggle").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByTestId("m360-expand-all"));
    expect(screen.getByTestId("m360-section-activity-toggle").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Manufacturer 360 navigation", () => {
  const rolesWithNav = ["manufacturer", "agency", "programme", "officer", "director", "finance", "auditor", "admin"] as const;

  it("registers the runtime route with expected nav roles", () => {
    const route = runtimeRouteFor("/app/demo/manufacturer-360");
    expect(route?.en).toBe("Manufacturer 360");
    for (const role of rolesWithNav) {
      expect(route?.navRoles.includes(role)).toBe(true);
    }
  });

  it("shows Manufacturer 360 in the menu for each listed persona", () => {
    for (const role of rolesWithNav) {
      expect(runtimeNavFor([{ role }]).some((r) => r.href === "/app/demo/manufacturer-360")).toBe(true);
    }
  });
});
