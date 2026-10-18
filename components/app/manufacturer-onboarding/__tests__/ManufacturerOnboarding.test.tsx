import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_APPLICATION_IDS, FIXTURE_OBSERVATION } from "@/lib/manufacturer-onboarding/fixtureSeed";
import { resetManufacturerOnboardingFixture } from "@/lib/manufacturer-onboarding/fixtureClient";
import { createFixtureManufacturerOnboardingClient } from "@/lib/manufacturer-onboarding/fixtureClient";
import {
  LABEL_ACTIVE_OBSERVATION,
  LABEL_AUTO_PAYMENT,
  LABEL_AUTO_RULES,
  LABEL_AWAITING_DIRECTOR,
  LABEL_HOLD,
  LABEL_REVOKED,
} from "@/lib/manufacturer-onboarding/statusLabels";
import { ONBOARDING_DISCLOSURE } from "@/lib/manufacturer-onboarding/types";
import { observationCountdown } from "@/lib/manufacturer-onboarding/observation";
import { canAccessManufacturerRoute, onboardingRoleFromPreview } from "@/lib/manufacturer-onboarding/access";
import { runtimeNavFor } from "@/lib/runtimeRoutes";
import RegisterManufacturerPage from "@/app/register/manufacturer/page";
import { ManufacturerOnboardingProvider } from "../ManufacturerOnboardingProvider";
import { OnboardingWizard } from "../OnboardingWizard";
import { ApplicationLifecycle } from "../ApplicationLifecycle";
import { DirectorQueue } from "../DirectorQueue";
import { MonitoringQueue } from "../MonitoringQueue";
import { Manufacturer360View } from "../Manufacturer360View";
import { ManufacturerRouteShell } from "../ManufacturerRouteShell";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
const previewRole = vi.hoisted(() => ({ role: "manufacturer" as string }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/app/manufacturer/onboarding",
}));

vi.mock("@/components/app/RoleContext", () => ({
  useRole: () => ({ role: previewRole.role, setRole: vi.fn(), ready: true }),
  PREVIEW_SUFFIX: " (preview)",
  previewRoleOf: (r: string) => ({ name: r, short: r }),
  ROLE_PREVIEW_ENABLED: true,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function wrap(ui: ReactNode, role: string = "manufacturer", nowMs?: number) {
  previewRole.role = role;
  const client = createFixtureManufacturerOnboardingClient();
  return (
    <ManufacturerOnboardingProvider client={client} nowMs={nowMs}>
      {ui}
    </ManufacturerOnboardingProvider>
  );
}

describe("manufacturer onboarding UI", () => {
  beforeEach(() => {
    resetManufacturerOnboardingFixture();
    nav.push.mockClear();
  });
  afterEach(() => cleanup());

  it("register page shows demo applicant identity and disclosure", () => {
    render(<RegisterManufacturerPage />);
    expect(screen.getByTestId("demo-applicant-identity").textContent).toContain("onboarding.applicant");
    expect(screen.getByText(/self-service identity provisioning is a demo follow-up/i)).toBeTruthy();
    expect(screen.getByText(ONBOARDING_DISCLOSURE)).toBeTruthy();
    expect(screen.getByTestId("continue-to-sign-in").getAttribute("href")).toBe("/login");
  });

  it("complete applicant wizard through submit", async () => {
    render(wrap(<OnboardingWizard />));
    await screen.findByTestId("field-legal-name");
    fireEvent.change(screen.getByTestId("field-legal-name"), { target: { value: "Aarav Appliances Pvt Ltd" } });
    fireEvent.change(screen.getByTestId("field-cin"), { target: { value: "U29300MH2018PTC312045" } });
    for (const key of ["line1", "city", "state", "pincode"] as const) {
      fireEvent.change(screen.getByTestId(`field-address-${key}`), { target: { value: "Demo value" } });
    }
    fireEvent.change(screen.getByTestId("field-signatory-name"), { target: { value: "Rahul Aarav" } });
    fireEvent.click(screen.getByTestId("step-annexure"));
    for (const btn of screen.getAllByRole("button", { name: /Mark uploaded/i })) fireEvent.click(btn);
    fireEvent.click(screen.getByTestId("step-declaration"));
    fireEvent.click(screen.getByTestId("checkbox-declaration"));
    fireEvent.click(screen.getByTestId("checkbox-agreement"));
    fireEvent.click(screen.getByTestId("step-review"));
    fireEvent.click(screen.getByTestId("wizard-submit"));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(expect.stringContaining("/app/manufacturer/application/")));
  });

  it("shows payment and check success labels on submitted application", async () => {
    render(wrap(<ApplicationLifecycle id={FIXTURE_APPLICATION_IDS.director} />));
    await screen.findByTestId("payment-block");
    expect(screen.getByText(LABEL_AUTO_PAYMENT)).toBeTruthy();
    expect(screen.getByText(LABEL_AUTO_RULES)).toBeTruthy();
    expect(screen.getByTestId("simulated-payment-note").textContent).toMatch(/simulated in demo mode/i);
  });

  it("Director approve and reject with mandatory reason", async () => {
    render(wrap(<DirectorQueue />, "director"));
    await screen.findByTestId("director-approve");
    fireEvent.click(screen.getByTestId("director-reject-open"));
    const dialog = screen.getByTestId("director-reject-dialog");
    fireEvent.click(within(dialog).getByTestId("director-reject-confirm"));
    expect((within(dialog).getByTestId("director-reject-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByTestId("director-reject-reason"), { target: { value: "Incomplete Annexure" } });
    fireEvent.click(within(dialog).getByTestId("director-reject-confirm"));
    await waitFor(() => expect(screen.getByText(/rejected/i)).toBeTruthy());
  });

  it("role visibility for routes and nav", () => {
    expect(onboardingRoleFromPreview("manufacturer")).toBe("applicant");
    expect(onboardingRoleFromPreview("director")).toBe("director");
    expect(onboardingRoleFromPreview("admin")).toBeNull();
    expect(canAccessManufacturerRoute("director", "finance")).toBe(false);
    expect(canAccessManufacturerRoute("monitoring", "finance")).toBe(true);
    expect(runtimeNavFor([{ role: "manufacturer" }]).some((r) => r.href === "/app/manufacturer/onboarding")).toBe(true);
    expect(runtimeNavFor([{ role: "finance" }]).some((r) => r.href === "/app/manufacturer/director")).toBe(false);
  });

  it("15-day observation display uses fixture end instant", async () => {
    const now = new Date(FIXTURE_OBSERVATION.observationStartedAt).getTime() + 86400000;
    render(wrap(<ApplicationLifecycle id={FIXTURE_APPLICATION_IDS.observation} />, "manufacturer", now));
    await screen.findByTestId("observation-countdown");
    const cd = observationCountdown(FIXTURE_OBSERVATION.observationEndsAt, now);
    expect(screen.getByTestId("observation-days").textContent).toBe(String(cd!.daysRemaining));
    expect(screen.getByText(LABEL_ACTIVE_OBSERVATION)).toBeTruthy();
  });

  it("Finance raises anomaly → immediate hold; Director resolve", async () => {
    render(wrap(<MonitoringQueue />, "finance"));
    await screen.findByTestId("monitoring-queue-list");
    fireEvent.change(screen.getByTestId("anomaly-summary"), { target: { value: "Fee mismatch demo" } });
    fireEvent.click(screen.getByTestId("raise-anomaly-submit"));
    await waitFor(() => expect(screen.getByText(LABEL_HOLD)).toBeTruthy());
  });

  it("Director revoke from hold", async () => {
    render(wrap(<MonitoringQueue />, "director"));
    await screen.findByTestId("monitoring-queue-list");
    const holdBtn = screen.getByRole("button", { name: /0104/i });
    fireEvent.click(holdBtn);
    await screen.findByText(LABEL_HOLD);
    fireEvent.change(screen.getByTestId("director-hold-note"), { target: { value: "Revoke demo" } });
    fireEvent.click(screen.getByTestId("director-revoke"));
    await waitFor(() => expect(screen.getByText(/revoked/i)).toBeTruthy());
  });

  it("Manufacturer 360 operational status", async () => {
    render(wrap(<Manufacturer360View id={FIXTURE_APPLICATION_IDS.revoked} />, "programme"));
    await screen.findByTestId("360-operational-status");
    expect(screen.getByText(LABEL_REVOKED)).toBeTruthy();
    expect(screen.getByTestId("360-identity").textContent).toContain("Aarav Appliances");
  });

  it("access denied for unsupported preview role", () => {
    previewRole.role = "admin";
    render(
      <ManufacturerOnboardingProvider client={createFixtureManufacturerOnboardingClient()}>
        <ManufacturerRouteShell>
          <div data-testid="secret">hidden</div>
        </ManufacturerRouteShell>
      </ManufacturerOnboardingProvider>,
    );
    expect(screen.getByTestId("onboarding-access-denied")).toBeTruthy();
    expect(screen.queryByTestId("secret")).toBeNull();
  });

  it("responsive navigation links present on wizard", async () => {
    render(wrap(<OnboardingWizard />));
    await screen.findByTestId("onboarding-nav");
    expect(screen.getByTestId("nav-onboarding-wizard").getAttribute("href")).toBe("/app/manufacturer/onboarding");
    expect(screen.getByTestId("nav-onboarding-application")).toBeTruthy();
  });

  it("submit button disabled when validation fails (no dead submit)", async () => {
    render(wrap(<OnboardingWizard />));
    await screen.findByTestId("wizard-submit");
    fireEvent.click(screen.getByTestId("step-review"));
    expect((screen.getByTestId("wizard-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("awaiting director label on director queue item", async () => {
    render(wrap(<DirectorQueue />, "director"));
    await screen.findByTestId("director-queue-list");
    expect(screen.getByText(LABEL_AWAITING_DIRECTOR)).toBeTruthy();
  });
});
