import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppTopbar } from "../AppTopbar";
import { VISIBLE_SELECTOR_ROLES } from "@/lib/roles";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => ({ status: "signed-in", me: { displayName: "Director", effectiveRoles: [{ role: "director", scope: "all" }], organisations: [] } }),
  SessionBadge: () => null,
}));
vi.mock("@/components/app/RoleContext", () => ({
  ROLE_PREVIEW_ENABLED: true,
  useRole: () => ({ role: "director", setRole: vi.fn(), ready: true }),
}));
vi.mock("@/components/i18n/LangProvider", () => ({ useLang: () => ({ t: (k: string) => k, lang: "en" }), LANGUAGE_SWITCH_ENABLED: false }));
vi.mock("@/lib/client/useDemoMode", () => ({ useDemoMode: () => "off" }));
vi.mock("@/components/app/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/app/notifications/DemoMessageBadge", () => ({ DemoMessageBadge: () => null }));
vi.mock("@/components/app/TopbarSearch", () => ({ TopbarSearch: () => null }));

afterEach(() => cleanup());

describe("AppTopbar role selector (Brief C3B)", () => {
  it("shows exactly five operational roles with clear labels", () => {
    render(<AppTopbar />);
    const select = screen.getByTestId("visible-role-selector") as HTMLSelectElement;
    const options = [...select.options].map((o) => ({ value: o.value, label: o.textContent?.replace(/\s*\(\d+\)\s*$/, "") ?? "" }));
    expect(options).toHaveLength(5);
    expect(options.map((o) => o.value)).toEqual(VISIBLE_SELECTOR_ROLES.map((r) => r.key));
    expect(options.map((o) => o.label)).toEqual(VISIBLE_SELECTOR_ROLES.map((r) => r.label));
    expect(select.textContent).not.toMatch(/programme|reviewer|iame|auditor|helpdesk|agency|pixel|laboratory|sda/i);
  });
});
