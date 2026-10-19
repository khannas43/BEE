import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NAVIGATION,
  NOT_IN_MENU,
  STANDALONE_PAGES,
  canOpenConsolePath,
  leaves,
  menuRoutesFor,
  navigationFor,
  type NavGroup,
} from "@/lib/navigation";
import { RUNTIME_ROUTES } from "@/lib/runtimeRoutes";
import { screenById } from "@/lib/screens";
import { AppSidebar } from "../AppSidebar";
import { RouteGuard } from "../RouteGuard";

const nav = vi.hoisted(() => ({ pathname: "/app" }));
const previewRole = vi.hoisted(() => ({ role: "admin" as string }));
type Identity = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; me: { displayName: string; effectiveRoles: { role: string; scope: string }[]; capabilities?: string[]; organisations: { code: string }[] } };
const identity = vi.hoisted(() => ({ state: { status: "loading" } as Identity }));

vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({ default: (props: { alt: string }) => <span role="img" aria-label={props.alt} /> }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock("@/components/app/SessionBadge", () => ({ useSpringIdentity: () => identity.state, rolesText: () => "", orgsText: () => "" }));
vi.mock("@/components/app/RoleContext", () => ({
  useRole: () => ({ role: previewRole.role, setRole: vi.fn(), ready: true }),
  PREVIEW_SUFFIX: " (preview)",
  previewRoleOf: (r: string) => ({ name: r, short: r }),
  ROLE_PREVIEW_ENABLED: true,
}));
vi.mock("@/components/i18n/LangProvider", () => ({ useLang: () => ({ t: (k: string) => k, lang: "en" }) }));

const grants = (...roles: string[]) => roles.map((role) => ({ role, scope: role === "manufacturer" ? "own-org" : "all" }));
const ADMIN_CAPS = ["fee_rule_manage", "rating_scheme_manage", "business_setting_manage", "fee_confirmation_correct"];
const menu = (roles: string[], caps: string[] = []) => navigationFor(grants(...roles), caps);
const routes = (groups: readonly NavGroup[]) => [...menuRoutesFor(groups)];
const titles = (groups: readonly NavGroup[]) => groups.flatMap((g) => leaves(g.children)).map((e) => e.title);

function signIn(roles: string[], caps: string[] = []) {
  identity.state = { status: "signed-in", me: { displayName: "Demo", effectiveRoles: grants(...roles), capabilities: caps, organisations: [] } };
}

function renderSidebar(roles: string[], pathname = "/app", caps: string[] = []) {
  signIn(roles, caps);
  nav.pathname = pathname;
  return render(<AppSidebar />);
}

afterEach(() => {
  cleanup();
  identity.state = { status: "loading" };
  previewRole.role = "admin";
  nav.pathname = "/app";
});

describe("navigation definition", () => {
  it("1. Manufacturer gets exactly its four groups", () => {
    expect(menu(["manufacturer"]).map((g) => g.title)).toEqual(["Dashboard", "Registration & Applications", "Labels & Operations", "Compliance & Support"]);
  });

  it("2. BEE Officer gets exactly four groups", () => {
    expect(menu(["officer"]).map((g) => g.title)).toEqual(["Dashboard", "Work Queue & Decisions", "Oversight & Intelligence", "Registers & Compliance"]);
  });

  it("3 and 4. Director and Finance get four groups or fewer, whatever their permissions", () => {
    expect(menu(["director"]).map((g) => g.title)).toEqual(["Dashboard", "Final Approvals", "Certificates & Formats", "Oversight & Reports"]);
    expect(menu(["finance"], ADMIN_CAPS).map((g) => g.title)).toEqual(["Dashboard", "Payments & Receipts", "Reconciliation", "Monitoring & Reports"]);
    for (const roles of [["admin"], ["manufacturer"], ["agency"], ["officer"], ["director"], ["finance"], ["programme"], ["reviewer"], ["iame"], ["auditor"], ["helpdesk"], ["officer", "finance"]]) {
      expect(menu(roles, ADMIN_CAPS).length).toBeLessThanOrEqual(4);
    }
  });

  it("5. Admin gets exactly four groups covering every working runtime route", () => {
    const admin = menu(["admin"], ADMIN_CAPS);
    expect(admin.map((g) => g.title)).toEqual(["Dashboards", "Registration & Applications", "Labels & Consumer Services", "Operations & Intelligence"]);
    const reached = new Set(routes(admin));
    const missing = RUNTIME_ROUTES.map((r) => r.href).filter((href) => !reached.has(href) && !(href in NOT_IN_MENU));
    expect(missing).toEqual([]);
    const elsewhere = NAVIGATION.filter((g) => g.profile !== "admin").flatMap((g) => leaves(g.children)).filter((e) => e.state === "available").map((e) => e.route!);
    expect(elsewhere.filter((r) => !reached.has(r))).toEqual([]);
  });

  it("every entry points at a route that exists, and IDs are unique", () => {
    const all = [...NAVIGATION.map((g) => ({ id: g.id })), ...NAVIGATION.flatMap((g) => { const walk = (es: readonly import("@/lib/navigation").NavEntry[]): { id: string }[] => es.flatMap((e) => [e, ...walk(e.children ?? [])]); return walk(g.children); })];
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (const e of NAVIGATION.flatMap((g) => leaves(g.children))) {
      if (e.state === "planned") { expect(e.route).toBeUndefined(); continue; }
      const r = e.route!;
      const [, , moduleId, screenId] = r.split("/");
      const ok = RUNTIME_ROUTES.some((x) => x.href === r) || !!screenById(moduleId, screenId) || r in STANDALONE_PAGES;
      expect(ok, `${e.id} → ${r}`).toBe(true);
    }
    expect(existsSync(path.join(process.cwd(), "app/(public)/verify/page.tsx"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "app/app/identity/access-management/page.tsx"))).toBe(true);
  });

  it("7 and 8. AI advisory and the secure ledger reach Admin and Officer, labelled advisory and simulated", () => {
    for (const roles of [["admin"], ["officer"]]) {
      const entries = menu(roles, ADMIN_CAPS).flatMap((g) => leaves(g.children));
      expect(entries.find((e) => e.route === "/app/demo/ai")?.badge).toBe("Advisory");
      expect(entries.find((e) => e.route === "/app/demo/ledger")?.badge).toBe("Simulated");
    }
  });

  it("9. Manufacturer sees no risk scoring and no internal BEE queue", () => {
    const m = menu(["manufacturer"]);
    const internal = ["/app/mis-ai/risk-scoring", "/app/model-label/iame-scrutiny", "/app/model-label/bee-scrutiny", "/app/model-label/director-approval", "/app/workflow/my-approvals", "/app/manufacturer/monitoring", "/app/finance/finance-queue", "/app/registrations/reviews", "/app/registrations/fees", "/app/demo/ai", "/app/demo/mis"];
    expect(routes(m).filter((r) => internal.includes(r) || r.startsWith("/app/mis-ai/"))).toEqual([]);
    expect(titles(m).filter((t) => /risk/i.test(t))).toEqual([]);
  });

  it("10. Finance has no payment-approval or fee-confirmation action", () => {
    const f = menu(["finance"]);
    expect(routes(f).filter((r) => ["/app/finance/finance-queue", "/app/registrations/fees", "/app/model-label/director-approval", "/app/workflow/my-approvals", "/app/model-label/model-payment"].includes(r))).toEqual([]);
    expect(titles(f).filter((t) => /approv|confirm/i.test(t))).toEqual([]);
  });

  it("11. Director has no manufacturer pre-approval", () => {
    const s = menu(["director"]);
    expect(routes(s).filter((r) => r.startsWith("/app/manufacturer/") || r === "/app/registrations/reviews")).toEqual([]);
    expect(titles(s).filter((t) => /company registration|pre-approval|onboarding/i.test(t))).toEqual([]);
  });

  it("menu entries for permission-gated screens follow the permission, not the role", () => {
    expect(routes(menu(["finance"]))).not.toContain("/app/administration/fee-rules");
    expect(routes(menu(["finance"], ["fee_rule_manage"]))).toContain("/app/administration/fee-rules");
    expect(routes(menu(["finance"], ["fee_confirmation_correct"]))).toContain("/app/finance/receipt");
    expect(routes(menu(["programme"]))).not.toContain("/app/finance/receipt");
    expect(routes(menu(["admin"]))).not.toContain("/app/administration/business-settings");
  });

  it("officer roles without their own hierarchy see Admin's, narrowed to their screens", () => {
    const p = menu(["programme"]);
    expect(p.length).toBeGreaterThan(0);
    expect(p.every((g) => g.profile === "admin")).toBe(true);
    expect(p.flatMap((g) => leaves(g.children)).every((e) => e.state === "available")).toBe(true);
    expect(routes(p)).toContain("/app/model-label/rating-calculation");
  });

  it("signed out, or with no recognised role, there is no menu", () => {
    expect(navigationFor(null)).toEqual([]);
    expect(navigationFor([])).toEqual([]);
    expect(navigationFor(grants("someone-else"))).toEqual([]);
  });
});

describe("sidebar", () => {
  it("6. no role sees an All screens or dev entry", () => {
    for (const roles of [["admin"], ["manufacturer"], ["officer"], ["director"], ["finance"], ["programme"]]) {
      const { container, unmount } = renderSidebar(roles);
      expect(container.textContent).not.toMatch(/all screens|app\.allScreens/i);
      expect(container.textContent).not.toMatch(/\bdev\b/i);
      expect(container.querySelector('a[href="/app/screens"]')).toBeNull();
      unmount();
    }
  });

  it("12. planned entries are shown with a Planned label and are not links", () => {
    const { container } = renderSidebar(["admin"]);
    const planned = [...container.querySelectorAll('[data-nav-state="planned"]')];
    expect(planned.length).toBeGreaterThan(0);
    for (const el of planned) {
      expect(el.tagName).not.toBe("A");
      expect(el.closest("a")).toBeNull();
      expect(el.getAttribute("aria-disabled")).toBe("true");
      expect(el.textContent).toContain("Planned");
    }
    const plannedIds = NAVIGATION.filter((g) => g.profile === "admin").flatMap((g) => leaves(g.children)).filter((e) => e.state === "planned").map((e) => e.id);
    expect(planned.map((el) => el.getAttribute("data-nav-id")).sort()).toEqual(plannedIds.sort());
  });

  it("preview entries carry a Preview label; runtime links keep their test IDs", () => {
    const { container } = renderSidebar(["officer"]);
    const risk = container.querySelector('[data-nav-id="dir.risk"]')!;
    expect(risk.textContent).toContain("Preview");
    expect(risk.textContent).toContain("Advisory");
    expect(container.querySelector('[data-testid="runtime-nav"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="runtime-nav-ai"]')?.getAttribute("href")).toBe("/app/demo/ai");
  });

  it("13. highlights the current page, keeps its group open and opens one other group at a time", () => {
    renderSidebar(["officer"], "/app/demo/ai");
    const groupButton = (id: string) => document.querySelector(`[data-nav-id="${id}"]`) as HTMLButtonElement;
    const current = document.querySelector('[aria-current="page"]')!;
    expect(current.getAttribute("data-nav-id")).toBe("dir.ai");
    expect(groupButton("dir.oversight").getAttribute("aria-expanded")).toBe("true");
    expect(groupButton("dir.work").getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(groupButton("dir.work").getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(true);

    fireEvent.click(groupButton("dir.work"));
    expect(groupButton("dir.work").getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    fireEvent.click(groupButton("dir.registers"));
    expect(groupButton("dir.registers").getAttribute("aria-expanded")).toBe("true");
    expect(groupButton("dir.work").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(groupButton("dir.oversight"));
    expect(groupButton("dir.oversight").getAttribute("aria-expanded")).toBe("true");

    groupButton("dir.dashboard").focus();
    fireEvent.keyDown(groupButton("dir.dashboard"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(groupButton("dir.work"));
    fireEvent.keyDown(groupButton("dir.work"), { key: "End" });
    expect(document.activeElement).toBe(groupButton("dir.registers"));
  });

  it("highlights a detail page through its parent entry and opens the nested parent", () => {
    renderSidebar(["admin"], "/app/model-label/director-approval", ADMIN_CAPS);
    expect(document.querySelector('[aria-current="page"]')?.getAttribute("data-nav-id")).toBe("admin.approval");
    expect(document.querySelector('[data-nav-id="admin.models"]')?.getAttribute("aria-expanded")).toBe("true");
    cleanup();
    renderSidebar(["manufacturer"], "/app/manufacturer/application/abc");
    expect(document.querySelector('[aria-current="page"]')?.getAttribute("data-nav-id")).toBe("mfr.status");
  });

  it("Admin sidebar shows the Admin profile label only (no demonstration note)", () => {
    const { container } = renderSidebar(["admin"]);
    expect(screen.getByTestId("nav-profile").textContent).toBe("Admin");
    expect(container.textContent).not.toMatch(/Consolidated view|read-only|demonstration umbrella/i);
    expect(screen.queryByTestId("nav-admin-note")).toBeNull();
  });

  it("14. the mobile drawer and the desktop sidebar render the same component and definition", () => {
    const layout = readFileSync(path.join(process.cwd(), "app/app/layout.tsx"), "utf8");
    expect(layout.match(/<AppSidebar\b/g)?.length).toBe(2);
    const onNavigate = vi.fn();
    signIn(["finance"]);
    const desktop = render(<AppSidebar />);
    const desktopLinks = [...desktop.container.querySelectorAll("[data-nav-id]")].map((e) => e.getAttribute("data-nav-id"));
    desktop.unmount();
    const mobile = render(<AppSidebar onNavigate={onNavigate} />);
    expect([...mobile.container.querySelectorAll("[data-nav-id]")].map((e) => e.getAttribute("data-nav-id"))).toEqual(desktopLinks);
    fireEvent.click(within(mobile.container).getByText("Finance overview"));
    expect(onNavigate).toHaveBeenCalled();
  });

  it("signed out shows a sign-in prompt instead of a menu", () => {
    identity.state = { status: "signed-out" };
    const { container } = render(<AppSidebar />);
    expect(screen.getByTestId("nav-signed-out").textContent).toContain("Sign in");
    expect(container.querySelector("[data-nav-id]")).toBeNull();
  });
});

describe("15. a preview role grants no route access", () => {
  it("the access decision ignores the preview role and follows Spring", () => {
    const admin = grants("admin"), mfr = grants("manufacturer");
    expect(canOpenConsolePath(admin, [], "/app/administration/appliance-master")).toBe(true);
    expect(canOpenConsolePath(mfr, [], "/app/administration/appliance-master")).toBe(false);
    expect(canOpenConsolePath(mfr, [], "/app/mis-ai/risk-scoring")).toBe(false);
    expect(canOpenConsolePath(mfr, [], "/app/screens")).toBe(false);
    expect(canOpenConsolePath(mfr, [], "/app/model-label/model-payment")).toBe(true);
    expect(canOpenConsolePath(null, [], "/app")).toBe(false);
  });

  it("a Manufacturer previewing as Admin keeps the Manufacturer menu and is refused an Admin screen", () => {
    previewRole.role = "admin";
    renderSidebar(["manufacturer"]);
    expect(screen.getByTestId("nav-profile").textContent).toBe("Manufacturer");
    expect(document.querySelector('[data-nav-id^="admin."]')).toBeNull();
    cleanup();

    nav.pathname = "/app/administration/appliance-master";
    render(<RouteGuard><p>secret admin screen</p></RouteGuard>);
    expect(screen.getByTestId("route-guard-refused")).toBeTruthy();
    expect(screen.queryByText("secret admin screen")).toBeNull();
  });

  it("an Admin sign-in opens the screen whatever the preview role; signed out is asked to sign in", () => {
    previewRole.role = "manufacturer";
    signIn(["admin"]);
    nav.pathname = "/app/administration/appliance-master";
    render(<RouteGuard><p>admin screen</p></RouteGuard>);
    expect(screen.getByText("admin screen")).toBeTruthy();
    expect(screen.getByTestId("preview-screen-note")).toBeTruthy();
    cleanup();

    identity.state = { status: "signed-out" };
    render(<RouteGuard><p>admin screen</p></RouteGuard>);
    expect(screen.getByTestId("route-guard-signed-out")).toBeTruthy();
    expect(screen.queryByText("admin screen")).toBeNull();
  });

  it("runtime routes are left to Spring", () => {
    identity.state = { status: "signed-out" };
    nav.pathname = "/app/demo/ai";
    render(<RouteGuard><p>runtime screen</p></RouteGuard>);
    expect(screen.getByText("runtime screen")).toBeTruthy();
  });
});
