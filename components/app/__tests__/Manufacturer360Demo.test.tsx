import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Manufacturer360Demo } from "@/components/app/demo/Manufacturer360Demo";
import { ALL_MANUFACTURERS as DIRECTORY } from "@/lib/demo/manufacturerDirectory";
import { runtimeNavFor, runtimeRouteFor } from "@/lib/runtimeRoutes";

const search = vi.hoisted(() => ({ value: "" }));

afterEach(() => cleanup());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/app/demo/manufacturer-360",
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => ({ status: "signed-in", me: { effectiveRoles: [{ role: "officer", scope: "all" }], organisations: [] } }),
}));
vi.mock("@/lib/client/runtimeCompanyRegistrations", () => ({
  readCompanyRegistrationsAwaitingApproval: async () => ({ ok: true, items: [] }),
}));

describe("Manufacturer360Demo", () => {
  it("lists every manufacturer and filters by search and status", () => {
    search.value = "";
    render(<Manufacturer360Demo />);
    expect(screen.getByTestId("m360-count").textContent).toContain(`${DIRECTORY.length} of ${DIRECTORY.length}`);
    fireEvent.change(screen.getByTestId("m360-search"), { target: { value: "pune" } });
    expect(screen.getByTestId("m360-count").textContent).toContain("2 of");
    fireEvent.change(screen.getByTestId("m360-search"), { target: { value: "" } });
    fireEvent.change(screen.getByTestId("m360-filter-status"), { target: { value: "On hold" } });
    expect(screen.getByTestId("m360-row-cinder-peak")).toBeTruthy();
    expect(screen.queryByTestId("m360-row-nova-cool")).toBeNull();
  });

  it("shows a profile with collapsible sections for the chosen manufacturer", () => {
    search.value = "m=nova-cool";
    render(<Manufacturer360Demo />);
    expect(screen.getByTestId("m360-header").textContent).toContain("Nova Cool Appliances Ltd.");
    expect(screen.getByTestId("m360-kpi-qr").textContent).toContain("1,240");
    const toggle = screen.getByTestId("m360-section-models-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("m360-section-models").textContent).toContain("BEE/RAC/2026/10101");
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
