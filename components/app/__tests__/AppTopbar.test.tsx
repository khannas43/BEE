import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppTopbar } from "../AppTopbar";
import { VISIBLE_SELECTOR_ROLES } from "@/lib/roles";

const identity = vi.hoisted(() => ({
  state: { status: "signed-out" as "signed-out" | "signed-in", me: { displayName: "Director", preferredUsername: "bee.director", effectiveRoles: [{ role: "director", scope: "all" }], organisations: [] } },
}));
const setRole = vi.hoisted(() => vi.fn());

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => identity.state,
  SessionBadge: ({ signedOut }: { signedOut?: ReactNode }) => <div data-testid="session-badge">{signedOut}</div>,
}));
vi.mock("@/components/app/RoleContext", () => ({
  ROLE_PREVIEW_ENABLED: true,
  useRole: () => ({ role: "director", setRole, ready: true }),
}));
vi.mock("@/components/i18n/LangProvider", () => ({ useLang: () => ({ t: (k: string) => k, lang: "en" }), LANGUAGE_SWITCH_ENABLED: false }));
vi.mock("@/components/app/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/app/notifications/DemoMessageBadge", () => ({ DemoMessageBadge: () => null }));
vi.mock("@/components/app/TopbarSearch", () => ({ TopbarSearch: () => null }));

describe("AppTopbar role selector (Brief C3B)", () => {
  beforeEach(() => {
    identity.state = { status: "signed-out", me: identity.state.me };
    setRole.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows exactly five operational roles with clear labels when signed out", () => {
    render(<AppTopbar />);
    const select = screen.getByTestId("visible-role-selector") as HTMLSelectElement;
    const options = [...select.options].map((o) => ({ value: o.value, label: o.textContent?.replace(/\s*\(\d+\)\s*$/, "") ?? "" }));
    expect(options).toHaveLength(5);
    expect(options.map((o) => o.value)).toEqual(VISIBLE_SELECTOR_ROLES.map((r) => r.key));
    expect(options.map((o) => o.label)).toEqual(VISIBLE_SELECTOR_ROLES.map((r) => r.label));
    expect(select.textContent).not.toMatch(/programme|reviewer|iame|auditor|helpdesk|agency|pixel|laboratory|sda/i);
  });

  it("hides the role selector when signed in", () => {
    identity.state = { status: "signed-in", me: identity.state.me };
    render(<AppTopbar />);
    expect(screen.queryByTestId("visible-role-selector")).toBeNull();
  });

  it("changing the selector updates local preview only and does not call demo login", () => {
    render(<AppTopbar />);
    const select = screen.getByTestId("visible-role-selector") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "manufacturer" } });
    expect(setRole).toHaveBeenCalledWith("manufacturer");
    const fetchMock = vi.mocked(fetch);
    const demoLoginCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/runtime/demo/login"));
    expect(demoLoginCalls).toHaveLength(0);
  });

  it("does not change Spring identity when signed in (no selector, no demo login)", () => {
    identity.state = {
      status: "signed-in",
      me: {
        displayName: "BEE Director",
        preferredUsername: "bee.director",
        effectiveRoles: [{ role: "director", scope: "all" }],
        organisations: [],
      },
    };
    render(<AppTopbar />);
    expect(screen.queryByTestId("visible-role-selector")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/runtime/demo/login"))).toHaveLength(0);
    expect(identity.state.me.preferredUsername).toBe("bee.director");
    expect(identity.state.me.effectiveRoles[0]?.role).toBe("director");
  });
});
