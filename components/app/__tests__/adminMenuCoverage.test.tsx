import { describe, expect, it } from "vitest";
import { ADMIN_RUNTIME_READ_ONLY_PROVEN, adminRuntimeRoutesMissingCoverage } from "@/lib/adminMenuCoverage";

describe("Admin menu read-only coverage (Brief C3A)", () => {
  it("every Admin available runtime menu route is proven or documented in NOT_IN_MENU", () => {
    const missing = adminRuntimeRoutesMissingCoverage();
    expect(missing, `Add ADMIN_RUNTIME_READ_ONLY_PROVEN or NOT_IN_MENU for: ${missing.join(", ")}`).toEqual([]);
  });

  it("documents at least the operational routes fixed in C3A", () => {
    for (const href of [
      "/app/manufacturer/onboarding",
      "/app/registrations/requests",
      "/app/finance/finance-queue",
      "/app/workflow/personal-inbox",
    ]) {
      expect(ADMIN_RUNTIME_READ_ONLY_PROVEN[href], href).toBeTruthy();
    }
  });
});
