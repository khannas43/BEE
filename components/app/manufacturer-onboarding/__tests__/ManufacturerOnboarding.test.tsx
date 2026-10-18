import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVISIONAL_COMPANY_REGISTRATION_FEE_INR, formatFeeInr } from "@/lib/manufacturer-onboarding/fees";
import { FIXTURE_APPLICATION_IDS } from "@/lib/manufacturer-onboarding/fixtureSeed";
import { resetManufacturerOnboardingFixture, createFixtureManufacturerOnboardingClient } from "@/lib/manufacturer-onboarding/fixtureClient";
import {
  LABEL_ACTIVE_OBSERVATION,
  LABEL_AUTO_PAYMENT,
  LABEL_AUTO_RULES,
  LABEL_AWAITING_DIRECTOR,
  LABEL_HOLD,
  LABEL_REJECTED,
  LABEL_REVOKED,
} from "@/lib/manufacturer-onboarding/statusLabels";
import { ONBOARDING_DISCLOSURE } from "@/lib/manufacturer-onboarding/types";
import { observationCountdown } from "@/lib/manufacturer-onboarding/observation";
import { canAccessManufacturerRoute } from "@/lib/manufacturer-onboarding/access";
import { effectiveOnboardingRoles } from "@/lib/manufacturer-onboarding/identity";
import { runtimeNavFor } from "@/lib/runtimeRoutes";
import { MANUFACTURER_ONBOARDING_DOCUMENT_KINDS } from "@/lib/manufacturer-onboarding/documentKinds";
import { MANUFACTURER_ONBOARDING_USE_FIXTURE } from "@/lib/manufacturer-onboarding/client";
import { createManufacturerOnboardingHttpClient, MANUFACTURER_ONBOARDING_BFF } from "@/lib/manufacturer-onboarding/httpClient";
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
type SpringState =
  | { status: "loading" }
  | { status: "signed-out" }
  | {
      status: "signed-in";
      me: { displayName: string; effectiveRoles: { role: string; scope: string }[]; organisations: { code: string }[] };
    };

const springIdentity = vi.hoisted(() => ({
  state: {
    status: "signed-in",
    me: {
      displayName: "Demo user",
      effectiveRoles: [{ role: "manufacturer", scope: "own-org" }],
      organisations: [{ code: "AARAV" }],
    },
  } as SpringState,
}));

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

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => springIdentity.state,
  rolesText: () => "",
  orgsText: () => "",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function springMe(role: string) {
  return {
    displayName: "Demo user",
    effectiveRoles: [{ role, scope: role === "manufacturer" ? "own-org" : "all" }],
    organisations: [{ code: "AARAV" }],
  };
}

function wrap(ui: ReactNode, springRole: string = "manufacturer", nowMs?: number) {
  previewRole.role = "manufacturer";
  springIdentity.state = { status: "signed-in", me: springMe(springRole) };
  const client = createFixtureManufacturerOnboardingClient({
    nowMs: nowMs ? () => nowMs : undefined,
    actor: () => ({ username: "demo", effectiveRoles: springMe(springRole).effectiveRoles }),
  });
  return (
    <ManufacturerOnboardingProvider client={client} nowMs={nowMs} identity={springMe(springRole)}>
      {ui}
    </ManufacturerOnboardingProvider>
  );
}

const feeDisplay = `₹ ${formatFeeInr(PROVISIONAL_COMPANY_REGISTRATION_FEE_INR)}`;

describe("manufacturer onboarding UI", () => {
  beforeEach(() => {
    resetManufacturerOnboardingFixture();
    nav.push.mockClear();
    springIdentity.state = { status: "signed-in", me: springMe("manufacturer") };
  });
  afterEach(() => cleanup());

  it("register page shows seeded identity and honest account wording", () => {
    render(<RegisterManufacturerPage />);
    expect(screen.getByTestId("demo-applicant-identity").textContent).toContain("onboarding.applicant");
    expect(screen.getByText(/does not dynamically create arbitrary Keycloak users/i)).toBeTruthy();
    expect(screen.getByTestId("sign-in-demo-applicant").textContent).toMatch(/Sign in with demonstration applicant/i);
    expect(screen.getByText(ONBOARDING_DISCLOSURE)).toBeTruthy();
  });

  it("wizard, lifecycle and 360 show the same ₹5,000 fee from the payment record", async () => {
    render(wrap(<OnboardingWizard />));
    await screen.findByTestId("field-legal-name");
    fireEvent.click(screen.getByTestId("step-fee"));
    await screen.findByTestId("wizard-fee");
    expect(screen.getByTestId("wizard-fee").textContent).toContain(feeDisplay);

    cleanup();
    render(wrap(<ApplicationLifecycle id={FIXTURE_APPLICATION_IDS.director} />));
    await screen.findByTestId("lifecycle-fee");
    expect(screen.getByTestId("lifecycle-fee").textContent).toContain(feeDisplay);

    cleanup();
    render(wrap(<Manufacturer360View id={FIXTURE_APPLICATION_IDS.director} />));
    await screen.findByTestId("360-fee");
    expect(screen.getByTestId("360-fee").textContent).toContain(feeDisplay);
  });

  it("complete applicant wizard through submit", async () => {
    render(wrap(<OnboardingWizard />));
    await screen.findByTestId("field-legal-name");
    fireEvent.change(screen.getByTestId("field-legal-name"), { target: { value: "Aarav Appliances Pvt Ltd" } });
    fireEvent.change(screen.getByTestId("field-cin"), { target: { value: "U29300MH2018PTC312045" } });
    fireEvent.click(screen.getByTestId("step-address"));
    for (const key of ["line1", "city", "state", "pincode"] as const) {
      fireEvent.change(screen.getByTestId(`field-address-${key}`), { target: { value: "Demo value" } });
    }
    fireEvent.click(screen.getByTestId("step-contacts"));
    fireEvent.change(screen.getByTestId("field-signatory-name"), { target: { value: "Rahul Aarav" } });
    fireEvent.click(screen.getByTestId("step-annexure"));
    const pdf = new File(["demo"], "demo.pdf", { type: "application/pdf" });
    for (const kind of MANUFACTURER_ONBOARDING_DOCUMENT_KINDS) {
      const input = screen.getByTestId(`upload-${kind}`) as HTMLInputElement;
      fireEvent.change(input, { target: { files: [pdf] } });
      await waitFor(() => expect(screen.getByTestId(`upload-status-${kind}`).textContent).toMatch(/Uploaded/i));
    }
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
  });

  it("automatic check failure UI and exclusion from director queue", async () => {
    render(wrap(<ApplicationLifecycle id={FIXTURE_APPLICATION_IDS.checksFailed} />));
    await screen.findByTestId("checks-failed-panel");
    expect(screen.getByTestId("checks-failed-wizard-link")).toBeTruthy();

    cleanup();
    render(wrap(<DirectorQueue />, "director"));
    await screen.findByTestId("director-queue-list");
    expect(screen.queryByText(/0107/i)).toBeNull();
  });

  it("Director approve and reject with mandatory reason", async () => {
    render(wrap(<DirectorQueue />, "director"));
    await screen.findByTestId("director-approve");
    fireEvent.click(screen.getByTestId("director-reject-open"));
    const dialog = screen.getByTestId("director-reject-dialog");
    fireEvent.change(within(dialog).getByTestId("director-reject-reason"), { target: { value: "Incomplete Annexure" } });
    fireEvent.click(within(dialog).getByTestId("director-reject-confirm"));
    await waitFor(() => expect(screen.getAllByText(LABEL_REJECTED).length).toBeGreaterThan(0));
  });

  it("Spring identity drives access; preview role does not grant Director actions", async () => {
    previewRole.role = "director";
    render(wrap(<DirectorQueue />, "manufacturer"));
    await screen.findByTestId("director-queue-list");
    expect(screen.queryByTestId("director-approve")).toBeNull();
    expect(screen.queryByTestId("director-reject-open")).toBeNull();
  });

  it("signed-in roles for route access", () => {
    const director = effectiveOnboardingRoles(springMe("director"));
    expect(canAccessManufacturerRoute("application", director)).toBe(true);
    expect(canAccessManufacturerRoute("director", director)).toBe(true);
    expect(canAccessManufacturerRoute("director", effectiveOnboardingRoles(springMe("finance")))).toBe(false);
    expect(runtimeNavFor([{ role: "finance" }]).some((r) => r.href === "/app/manufacturer/director")).toBe(false);
  });

  it("15-day observation display uses stored end instant", async () => {
    const client = createFixtureManufacturerOnboardingClient();
    const app = await client.getApplication(FIXTURE_APPLICATION_IDS.observation);
    const now = new Date(app.observationStartedAt!).getTime() + 86400000;
    render(wrap(<ApplicationLifecycle id={FIXTURE_APPLICATION_IDS.observation} />, "manufacturer", now));
    await screen.findByTestId("observation-countdown");
    const cd = observationCountdown(app.observationEndsAt, now);
    expect(screen.getByTestId("observation-days").textContent).toBe(String(cd!.daysRemaining));
    expect(screen.getByText(LABEL_ACTIVE_OBSERVATION)).toBeTruthy();
  });

  it("Finance raises anomaly → immediate hold", async () => {
    render(wrap(<MonitoringQueue />, "finance"));
    await screen.findByTestId("monitoring-queue-list");
    fireEvent.click(screen.getByTestId("monitoring-item-MFG-ONB-2026-0103"));
    await screen.findByTestId("anomaly-summary");
    fireEvent.change(screen.getByTestId("anomaly-summary"), { target: { value: "Fee mismatch demo" } });
    fireEvent.click(screen.getByTestId("raise-anomaly-submit"));
    await waitFor(() => expect(screen.getByText(LABEL_HOLD)).toBeTruthy());
  });

  it("Director revoke from hold", async () => {
    render(wrap(<MonitoringQueue />, "director"));
    await screen.findByTestId("monitoring-queue-list");
    fireEvent.click(screen.getByTestId("monitoring-item-MFG-ONB-2026-0104"));
    await screen.findByTestId("director-hold-note");
    fireEvent.change(screen.getByTestId("director-hold-note"), { target: { value: "Revoke demo" } });
    fireEvent.click(screen.getByTestId("director-revoke"));
    await waitFor(() => expect(screen.getAllByText(LABEL_REVOKED).length).toBeGreaterThan(0));
  });

  it("Manufacturer 360 operational status", async () => {
    render(wrap(<Manufacturer360View id={FIXTURE_APPLICATION_IDS.revoked} />, "programme"));
    await screen.findByTestId("360-operational-status");
    expect(screen.getAllByText(LABEL_REVOKED).length).toBeGreaterThan(0);
  });

  it("access denied for unsupported signed-in role", () => {
    springIdentity.state = { status: "signed-in", me: springMe("admin") };
    render(
      <ManufacturerOnboardingProvider client={createFixtureManufacturerOnboardingClient()} identity={springMe("admin")}>
        <ManufacturerRouteShell>
          <div data-testid="secret">hidden</div>
        </ManufacturerRouteShell>
      </ManufacturerOnboardingProvider>,
    );
    expect(screen.getByTestId("onboarding-access-denied")).toBeTruthy();
  });

  it("signed-out shows sign-in requirement on gated route", () => {
    springIdentity.state = { status: "signed-out" };
    render(
      <ManufacturerRouteShell>
        <div data-testid="secret">hidden</div>
      </ManufacturerRouteShell>,
    );
    expect(screen.getByTestId("onboarding-sign-in-required")).toBeTruthy();
  });

  it("director queue empty message after load", async () => {
    const client = createFixtureManufacturerOnboardingClient();
    vi.spyOn(client, "listDirectorQueue").mockResolvedValue([]);
    render(
      <ManufacturerOnboardingProvider client={client} identity={springMe("director")}>
        <DirectorQueue />
      </ManufacturerOnboardingProvider>,
    );
    await screen.findByTestId("director-queue-empty");
    expect(screen.getByText("No applications awaiting Director decision.")).toBeTruthy();
  });

  it("default client path is HTTP; fixture requires explicit flag", () => {
    expect(MANUFACTURER_ONBOARDING_USE_FIXTURE).toBe(false);
    const c = createManufacturerOnboardingHttpClient(async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    expect(c.listDirectorQueue).toBeTypeOf("function");
    expect(MANUFACTURER_ONBOARDING_BFF.list).toBe("/api/runtime/manufacturer-onboarding");
  });

  it("awaiting director label on director queue item", async () => {
    render(wrap(<DirectorQueue />, "director"));
    await screen.findByTestId("director-queue-list");
    expect(screen.getAllByText(LABEL_AWAITING_DIRECTOR).length).toBeGreaterThan(0);
  });
});
