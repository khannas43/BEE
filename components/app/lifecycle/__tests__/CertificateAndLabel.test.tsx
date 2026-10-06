import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CertificateAndLabel } from "@/components/app/lifecycle/CertificateAndLabel";
import { deferredFetches, installDeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";
import { verificationUrl } from "@/lib/client/qr";

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div data-testid="screen-chrome">{children}</div>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => ({
    status: "signed-in" as const,
    me: { displayName: "Nova Applicant", roles: [{ code: "manufacturer", label: "Manufacturer" }], organisations: [] },
  }),
  rolesText: () => "manufacturer",
  orgsText: () => "",
}));

const navState = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => navState.params }));

const CERT = {
  registrationId: "BEE/RAC/2026/10001", validFrom: "2026-10-06", validTo: "2029-10-05", status: "valid", stars: 4, declaredIseer: "4.50", verifiedIseer: "4.62",
  schemeKey: "RAC-ISEER-DEMO-1", localDemoCertificate: true, issuedAt: "2026-10-06T10:00:00Z",
};
const app = (over: Record<string, unknown>) => ({
  id: "a1", reference: "LOCAL-MA-0001", organisation: "NOVA", brandName: "Nova Cool", category: "RAC", modelNumber: "NC-1", state: "approved", version: 8, readBasis: ["own-org"], certificate: CERT, ...over,
});

describe("CertificateAndLabel", () => {
  beforeEach(() => {
    installDeferredFetch();
    navState.params = new URLSearchParams();
    cleanup();
  });

  it("lists only the approved applications, each with a link to its certificate", async () => {
    render(<CertificateAndLabel module={"model-label" as never} screen={"label-preview" as never} />);
    await act(async () => {
      deferredFetches()[0].resolve({ items: [app({}), app({ id: "a2", reference: "LOCAL-MA-0002", state: "fee_due", certificate: undefined })], count: 2, authority: "spring-database" });
    });
    expect(screen.getByTestId("certdocs-open-LOCAL-MA-0001").getAttribute("href")).toBe("/app/model-label/label-preview?id=a1");
    expect(screen.queryByTestId("certdocs-open-LOCAL-MA-0002")).toBeNull();
  });

  it("says so when nothing has been approved yet", async () => {
    render(<CertificateAndLabel module={"model-label" as never} screen={"label-preview" as never} />);
    await act(async () => {
      deferredFetches()[0].resolve({ items: [app({ state: "fee_due", certificate: undefined })], count: 1, authority: "spring-database" });
    });
    expect(screen.getByTestId("certdocs-empty").textContent).toContain("No application of yours has been approved yet");
  });

  it("shows the certificate and the label with the same QR code, pointing to the verification page, and says it is a demonstration", async () => {
    navState.params = new URLSearchParams({ id: "a1" });
    render(<CertificateAndLabel module={"model-label" as never} screen={"label-preview" as never} />);
    await act(async () => {
      deferredFetches()[0].resolve(app({}));
    });
    const expected = verificationUrl(window.location.origin, "BEE/RAC/2026/10001");
    expect(screen.getByTestId("certificate-registration").textContent).toBe("BEE/RAC/2026/10001");
    expect(screen.getByTestId("certificate-model").textContent).toBe("Nova Cool NC-1");
    expect(screen.getByTestId("certificate-validity").textContent).toBe("2026-10-06 to 2029-10-05 (valid)");
    expect(screen.getByTestId("certificate-qr").getAttribute("data-qr-text")).toBe(expected);
    expect(screen.getByTestId("label-qr").getAttribute("data-qr-text")).toBe(expected);
    expect(screen.getByTestId("label-iseer").textContent).toBe("ISEER 4.62");
    expect(screen.getByTestId("certificate-demo").textContent).toContain("LOCAL DEMONSTRATION");
    expect(screen.getByTestId("label-demo").textContent).toContain("not issued by BEE");
  });

  it("prints with the browser's print and does not show an application that has no certificate", async () => {
    navState.params = new URLSearchParams({ id: "a1" });
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<CertificateAndLabel module={"model-label" as never} screen={"label-preview" as never} />);
    await act(async () => {
      deferredFetches()[0].resolve(app({}));
    });
    fireEvent.click(screen.getByTestId("certdocs-print"));
    expect(print).toHaveBeenCalledTimes(1);
    cleanup();
    installDeferredFetch();
    render(<CertificateAndLabel module={"model-label" as never} screen={"label-preview" as never} />);
    await act(async () => {
      deferredFetches()[0].resolve(app({ state: "fee_due", certificate: undefined }));
    });
    expect(screen.getByTestId("certdocs-none").textContent).toContain("only an approved application is issued one");
    expect(screen.queryByTestId("certificate-document")).toBeNull();
  });
});
