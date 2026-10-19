import { cleanup, render, screen as view } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminDemonstrationBanner } from "../AdminDemonstrationBanner";
import { RegistrationList } from "../registrations/RegistrationList";
import { ScreenChrome } from "../ScreenScaffold";
import { moduleById, screenById } from "@/lib/screens";

const identity = vi.hoisted(() => ({
  state: { status: "signed-in" as const, me: { displayName: "Admin", effectiveRoles: [{ role: "admin", scope: "all" }], organisations: [], adminDemonstrationReadOnly: true } },
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/app", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/app/SessionBadge", () => ({ useSpringIdentity: () => identity.state, rolesText: () => "", orgsText: () => "" }));
vi.mock("@/lib/adminDemonstration", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/adminDemonstration")>();
  return {
    ...mod,
    useAdminDemonstrationReadOnly: () =>
      identity.state.status === "signed-in" && identity.state.me.adminDemonstrationReadOnly === true,
  };
});
vi.mock("@/components/app/RoleContext", () => ({ useRole: () => ({ role: "admin", setRole: vi.fn(), ready: true }) }));
vi.mock("@/components/i18n/LangProvider", () => ({ useLang: () => ({ t: (k: string) => k, lang: "en" }) }));
vi.mock("@/components/app/kit/useRuntimeRead", () => ({
  useRevalidation: () => ({ refresh: vi.fn() }),
  useRuntimeRead: () => ({ phase: "ok", value: { list: { count: 1, items: [{ id: "a1", reference: "LOCAL-MA-0001", organisation: "NOVA", brandName: "Nova", modelNumber: "X", submittedAt: "2026-01-01", submissionFee: { totalInr: "100" } }] } } }),
}));
vi.mock("@/lib/client/runtimeModelApplications", () => ({
  readModelApplicationList: vi.fn(),
  readModelApplication: vi.fn(),
  stateLabel: (s: string) => s,
}));
vi.mock("@/lib/client/runtimeRegistrations", () => ({
  readRegistrationList: vi.fn(),
  registrationListHref: () => "/app/registrations/requests",
  registrationNewHref: () => "/app/registrations/new",
}));
vi.mock("@/lib/client/runtimeHttp", () => ({ gateRead: (_s: string, r: unknown) => r }));
vi.mock("@/components/app/kit/IdentityStrip", () => ({ IdentityStrip: () => null }));
vi.mock("@/components/app/kit/StatePanels", () => ({
  ReadPanel: ({ children }: { children: (r: unknown) => ReactNode }) => (
    <div data-testid="read-panel">{children({ list: { count: 1, items: [] } })}</div>
  ),
  DescriptionList: () => null,
}));
vi.mock("@/components/app/kit/CommandPanel", () => ({ CommandPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>, useCommand: () => ({ state: { phase: "idle" }, execute: vi.fn() }) }));

afterEach(() => {
  cleanup();
  identity.state = { status: "signed-in", me: { displayName: "Admin", effectiveRoles: [{ role: "admin", scope: "all" }], organisations: [], adminDemonstrationReadOnly: true } };
});

describe("Admin demonstration read-only UI", () => {
  it("shows the banner copy from the brief", () => {
    render(<AdminDemonstrationBanner />);
    expect(view.getByTestId("admin-demonstration-banner").textContent).toContain(
      "Admin demonstration view — read-only. Actions remain available only to the responsible operational role.",
    );
  });

  it("ScreenChrome hides header actions for read-only Admin", () => {
    const module = moduleById("finance")!;
    const pageScreen = screenById("finance", "finance-queue")!;
    render(
      <ScreenChrome module={module} screen={pageScreen} actions={<button type="button">Act</button>} implemented={["List"]}>
        <p>Body</p>
      </ScreenChrome>,
    );
    expect(view.getByTestId("admin-demonstration-banner")).toBeTruthy();
    expect(view.queryByText("Act")).toBeNull();
  });

  it("Registration list hides New request for read-only Admin", () => {
    const module = moduleById("model-label")!;
    const dashboard = screenById("model-label", "model-dashboard")!;
    const pageScreen = { ...dashboard, id: "registration-requests", name: "Registration requests" };
    render(<RegistrationList module={module} screen={pageScreen} />);
    expect(view.queryByTestId("reg-new")).toBeNull();
  });

});
