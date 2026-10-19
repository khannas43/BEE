import { describe, expect, it } from "vitest";
import { categoriesForRole } from "@/lib/categories";
import { runtimeNavFor } from "@/lib/runtimeRoutes";
import {
  filterCategoriesForRegistrationDemo,
  filterRuntimeNavForRegistrationDemo,
  isManufacturerRegistrationDemoIdentity,
  manufacturerRegistrationDemoBlocksPath,
} from "@/lib/manufacturer-onboarding/manufacturerNavPolicy";

describe("manufacturerNavPolicy", () => {
  it("detects VIRAA-only manufacturer as registration demo", () => {
    expect(
      isManufacturerRegistrationDemoIdentity([{ role: "manufacturer" }], [{ code: "VIRAA" }]),
    ).toBe(true);
    expect(
      isManufacturerRegistrationDemoIdentity([{ role: "manufacturer" }], [{ code: "NOVA" }]),
    ).toBe(false);
  });

  it("limits runtime nav to company registration", () => {
    const nav = runtimeNavFor([{ role: "manufacturer" }]);
    const limited = filterRuntimeNavForRegistrationDemo(nav);
    expect(limited.map((r) => r.href)).toEqual(["/app/manufacturer/onboarding"]);
    expect(limited.some((r) => r.href === "/app/model-label/model-dashboard")).toBe(false);
  });

  it("hides registration and model categories for demo manufacturer", () => {
    const cats = filterCategoriesForRegistrationDemo(categoriesForRole("manufacturer"));
    expect(cats.some((c) => c.id === "registrations")).toBe(false);
    expect(cats.some((c) => c.id === "labels-production")).toBe(false);
    expect(cats.find((c) => c.id === "home")?.items.map((i) => i.href)).toEqual(["/app"]);
  });

  it("blocks model and brand paths until registration completes", () => {
    expect(manufacturerRegistrationDemoBlocksPath("/app/model-label/model-dashboard")).toBe(true);
    expect(manufacturerRegistrationDemoBlocksPath("/app/registrations/requests")).toBe(true);
    expect(manufacturerRegistrationDemoBlocksPath("/app/manufacturer/onboarding")).toBe(false);
    expect(manufacturerRegistrationDemoBlocksPath("/app")).toBe(false);
  });
});
