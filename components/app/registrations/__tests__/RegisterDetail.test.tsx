import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterDetail } from "@/components/app/registrations/RegisterDetail";
import type { RegisterRevocations } from "@/lib/client/runtimeRegisterRevocations";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@/lib/client/runtimeManufacturers", async (orig) => ({
  ...(await orig<typeof import("@/lib/client/runtimeManufacturers")>()),
  useManufacturers: () => ({
    phase: "ready",
    list: [{
      id: "o1", code: "NOVA", name: "Nova Cool Appliances Pvt Ltd", status: "Suspended", state: "Delhi", city: "New Delhi", categories: ["RAC"], since: "12 Mar 2024",
      permitteeNumber: "PT-1", applicationId: null, applicationReference: null, cin: null, gstin: null, address: null,
      signatory: { name: null, designation: null, email: null, phone: null }, facilities: [],
      brands: [{ id: "b1", name: "Nova Cool", status: "suspended", reason: "Label fee notices unanswered for 60 days.", changedOn: null, authorisations: 1 }],
      models: [], fees: { paid: 0, outstanding: 0, payments: [] }, qr: { issued: 0, bound: 0, unused: 0 }, production: [], documents: [], observation: null,
      anomalies: [], flags: [], timeline: [],
    }],
  }),
}));

afterEach(() => cleanup());

const proposal = {
  id: "p1", targetKind: "brand" as const, targetId: "b1", targetLabel: "Nova Cool", action: "revoke" as const, closeOn: null,
  reason: "Brand name disputed by another owner", state: "approved" as const, proposedBy: "BEE Programme", proposedByYou: false,
  proposedAt: "2026-10-01T05:00:00Z", decidedBy: "BEE Officer", decidedAt: "2026-10-02T05:00:00Z", decisionNote: "Confirmed",
};
const register: RegisterRevocations = {
  today: "2026-10-19", canPropose: true, canDecide: true,
  brands: [{ id: "b1", name: "Nova Cool", owner: "NOVA", status: "suspended", source: "Register demonstration data" }],
  authorisations: [{ id: "a1", brandId: "b1", brandName: "Nova Cool", agency: "PixelCert", principal: "NOVA", validFrom: "2026-01-01", validTo: "2026-12-31", status: "active", source: "Register demonstration data" }],
  pending: [],
  decided: [proposal],
};

describe("RegisterDetail", () => {
  it("shows a brand with its owner profile link, authorisations and proposals", () => {
    render(<RegisterDetail register={register} view="brand" id="b1" />);
    expect(screen.getByTestId("rvk-detail-brand").textContent).toContain("Nova Cool");
    expect(document.querySelector('a[href="/app/demo/manufacturer-360?m=NOVA"]')).toBeTruthy();
    expect(screen.getByTestId("rvk-status-reason").textContent).toContain("Label fee notices unanswered");
    expect(document.querySelector('a[href*="view=authorisation&id=a1"]')).toBeTruthy();
    expect(document.querySelector('a[href*="view=proposal&id=p1"]')).toBeTruthy();
  });

  it("shows an authorisation and a proposal, and a not-found page for an unknown id", () => {
    const { unmount } = render(<RegisterDetail register={register} view="authorisation" id="a1" />);
    expect(screen.getByTestId("rvk-detail-authorisation").textContent).toContain("PixelCert");
    unmount();
    const second = render(<RegisterDetail register={register} view="proposal" id="p1" />);
    expect(screen.getByTestId("rvk-detail-proposal").textContent).toContain("Confirmed");
    second.unmount();
    render(<RegisterDetail register={register} view="brand" id="nope" />);
    expect(screen.getByTestId("rvk-detail-missing")).toBeTruthy();
  });
});
