import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Manufacturer360Demo } from "@/components/app/demo/Manufacturer360Demo";
import {
  DEMO_DISCLOSURE,
  MANUFACTURER_360_STAGES,
  WP9_PREVIEW_LABEL,
} from "@/lib/demo/manufacturer360Fixture";
import { runtimeNavFor, runtimeRouteFor } from "@/lib/runtimeRoutes";

afterEach(() => cleanup());

describe("Manufacturer360Demo", () => {
  it("renders seven WP lifecycle stages with working-screen links", () => {
    render(<Manufacturer360Demo />);
    for (const stage of MANUFACTURER_360_STAGES) {
      expect(screen.getByTestId(`m360-stage-${stage.wp}`)).toBeTruthy();
      const link = screen.getByTestId(`m360-stage-link-${stage.wp}`);
      expect(link.getAttribute("href")).toBe(stage.screenHref);
    }
  });

  it("includes required working-screen links from the brief", () => {
    render(<Manufacturer360Demo />);
    const hrefs = [
      "/app/registrations/requests",
      "/app/registrations/reviews",
      "/app/registrations/register",
      "/app/model-label/model-dashboard",
      "/app/model-label/label-preview",
      "/app/demo/payments",
      "/app/demo/qr",
      "/app/demo/production",
      "/app/demo/executive",
      "/app/demo/mis",
      "/app/model-label/renewal-or-degradation",
      "/app/withdrawal/brand-withdrawal",
      "/verify",
    ];
    for (const href of hrefs) {
      const el = document.querySelector(`a[href="${href}"]`);
      expect(el, `missing link ${href}`).toBeTruthy();
    }
  });

  it("labels WP9 preview cards that are not working production flows", () => {
    render(<Manufacturer360Demo />);
    expect(screen.getByTestId("m360-wp9-preview-label-renewal-due").textContent).toContain(WP9_PREVIEW_LABEL);
    expect(screen.getByTestId("m360-wp9-preview-label-voluntary-withdrawal").textContent).toContain(WP9_PREVIEW_LABEL);
    expect(screen.queryByTestId("m360-wp9-preview-label-revocation-active")).toBeNull();
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
