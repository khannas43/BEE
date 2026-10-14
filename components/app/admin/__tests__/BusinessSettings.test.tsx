import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessSettings, dayAfter } from "@/components/app/admin/BusinessSettings";
import { deferredFetches, installDeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";
import { runtimeNavFor } from "@/lib/runtimeRoutes";

const identityState = vi.hoisted(() => ({ status: "signed-in" as "loading" | "signed-in" | "signed-out" }));

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div data-testid="screen-chrome">{children}</div>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => ({
    status: identityState.status,
    me: { displayName: "BEE Admin", roles: [{ code: "admin", label: "Administrator" }], organisations: [] },
  }),
  rolesText: () => "admin",
  orgsText: () => "",
}));

const proposal = (over: Record<string, unknown>) => ({
  id: "p1", settingKey: "declared_iseer_max", label: "Highest efficiency figure an applicant may declare", unit: "ISEER",
  effectiveFrom: "2026-10-15", value: "95.00", valueBefore: "90.00", sourceReference: "Circular 2026/14", reason: "Lower the cap",
  state: "pending", proposedBy: "BEE Finance", proposedByYou: false, proposedAt: "2026-10-04T10:00:00Z",
  decidedBy: null, decidedAt: null, decisionNote: null, applied: false, ...over,
});

const iseer = {
  key: "declared_iseer_max", label: "Highest efficiency figure an applicant may declare", unit: "ISEER",
  description: "Owner's assumption: 99.99, because BEE has not stated the range.",
  warning: "Drafts already saved with a higher figure cannot be submitted until the figure is corrected.",
  decimals: 2, min: "1.00", max: "99.99", defaultValue: "99.99", valueInForce: "90.00", inForceFrom: "2026-01-01",
  scheduled: [{ effectiveFrom: "2026-11-01", value: "95.00", source: "Circular" }],
  versions: [],
};

const age = {
  key: "test_report_max_age_days", label: "Oldest test date accepted", unit: "days before submission",
  description: "Owner's assumption: 1095 days (three years).",
  warning: null, decimals: 0, min: "1", max: "3650", defaultValue: "1095", valueInForce: "1095", inForceFrom: null,
  scheduled: [
    { effectiveFrom: "2027-01-01", value: "800", source: "Note" },
    { effectiveFrom: "2026-12-01", value: "1000", source: "Note" },
  ],
  versions: [],
};

const admin = (pending: unknown[] = []) => ({ today: "2026-10-04", settings: [iseer, age], pending, decided: [] });

async function load(body: unknown, status = 200) {
  cleanup();
  render(<BusinessSettings module={"administration" as never} screen={"business-settings" as never} />);
  await act(async () => {
    deferredFetches()[0].resolve(body, status);
  });
}

function openForm(key: string) {
  fireEvent.click(screen.getByTestId(`bizsetting-propose-${key}`));
}

describe("BusinessSettings", () => {
  beforeEach(() => {
    identityState.status = "signed-in";
    installDeferredFetch();
  });

  it("renders each definition with its value, and every scheduled version earliest first", async () => {
    await load(admin());
    const cap = screen.getByTestId("bizsetting-value-declared_iseer_max");
    expect(cap.textContent).toContain("90.00");
    expect(cap.textContent).toContain("from 2026-01-01");
    expect(cap.getAttribute("data-default")).toBe("false");
    expect(screen.getByTestId("bizsetting-row-declared_iseer_max").textContent).toContain("ISEER");
    const scheduled = screen.getByTestId("bizsetting-scheduled-declared_iseer_max");
    expect(scheduled.textContent).toContain("95.00 ISEER from 2026-11-01");
    const ageScheduled = screen.getByTestId("bizsetting-scheduled-test_report_max_age_days");
    const items = [...ageScheduled.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["1000 days before submission from 2026-12-01", "800 days before submission from 2027-01-01"]);
    expect(screen.getByTestId("bizsettings-notes").textContent).toContain("different person approves");
    expect(screen.getByTestId("bizsettings-pending-empty")).toBeTruthy();
  });

  it("labels the catalogue default when no version is in force", async () => {
    await load(admin());
    const cell = screen.getByTestId("bizsetting-value-test_report_max_age_days");
    expect(cell.getAttribute("data-default")).toBe("true");
    expect(cell.textContent).toContain("1095");
    expect(cell.textContent).toContain("default, not a BEE rule");
  });

  it("shows the empty note when the service returns no definitions", async () => {
    await load({ today: "2026-10-04", settings: [], pending: [], decided: [] });
    expect(screen.getByTestId("bizsettings-empty").textContent).toContain("No business setting exists yet.");
    expect(screen.queryByTestId("bizsetting-propose")).toBeNull();
  });

  it("builds the form from the definition: range, unit, note, warning, and tomorrow as the start", async () => {
    await load(admin());
    openForm("declared_iseer_max");
    const value = screen.getByTestId("bizsetting-value");
    expect(value.getAttribute("min")).toBe("1.00");
    expect(value.getAttribute("max")).toBe("99.99");
    expect(value.getAttribute("inputmode")).toBe("decimal");
    expect(value.getAttribute("data-decimals")).toBe("2");
    expect(screen.getByTestId("bizsetting-min").textContent).toBe("1.00");
    expect(screen.getByTestId("bizsetting-max").textContent).toBe("99.99");
    expect(screen.getByTestId("bizsetting-unit").textContent).toBe("ISEER");
    expect(screen.getByTestId("bizsetting-description").textContent).toContain("Owner's assumption: 99.99");
    expect(screen.getByTestId("bizsetting-warning").textContent).toContain("cannot be submitted");
    expect((screen.getByTestId("bizsetting-from") as HTMLInputElement).value).toBe("2026-10-05");

    openForm("test_report_max_age_days");
    const days = screen.getByTestId("bizsetting-value");
    expect(days.getAttribute("min")).toBe("1");
    expect(days.getAttribute("max")).toBe("3650");
    expect(days.getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByTestId("bizsetting-description").textContent).toContain("1095 days");
    expect(screen.queryByTestId("bizsetting-warning")).toBeNull();
  });

  it("refuses a decimal point on a whole-number setting and sends nothing", async () => {
    await load(admin());
    openForm("test_report_max_age_days");
    fireEvent.change(screen.getByTestId("bizsetting-value"), { target: { value: "10.5" } });
    expect((screen.getByTestId("bizsetting-value") as HTMLInputElement).value).toBe("");
    const before = deferredFetches().length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("bizsetting-propose-run"));
    });
    expect(screen.getByTestId("bizsetting-propose-input-error").textContent).toContain("whole number");
    expect(deferredFetches().length).toBe(before);
  });

  it("sends a complete proposal and shows that a different person must approve it", async () => {
    await load(admin());
    openForm("declared_iseer_max");
    fireEvent.change(screen.getByTestId("bizsetting-value"), { target: { value: "95.00" } });
    fireEvent.change(screen.getByTestId("bizsetting-source"), { target: { value: "Circular 2026/14" } });
    fireEvent.change(screen.getByTestId("bizsetting-reason"), { target: { value: "Lower the cap" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("bizsetting-propose-run"));
    });
    const call = deferredFetches().find((c) => c.url.endsWith("/api/runtime/business-settings/proposals"))!;
    expect(JSON.parse(String(call.init?.body))).toEqual({
      settingKey: "declared_iseer_max", value: "95.00", effectiveFrom: "2026-10-05", sourceReference: "Circular 2026/14", reason: "Lower the cap",
    });
    await act(async () => {
      call.resolve(proposal({ proposedByYou: true, proposedBy: "BEE Admin", effectiveFrom: "2026-10-05" }), 201);
    });
    expect(screen.getByTestId("bizsetting-propose-success").textContent).toContain("90.00 → 95.00 from 2026-10-05");
    expect(screen.getByTestId("bizsetting-propose-success").textContent).toContain("different person must approve");
  });

  it("prints the value before the change, and offers approve and reject only on a colleague's proposal", async () => {
    await load(admin([proposal({ id: "p1" }), proposal({ id: "p2", proposedByYou: true, proposedBy: "BEE Admin" })]));
    expect(screen.getByTestId("bizsettings-pending-p1").textContent).toContain("Highest efficiency figure an applicant may declare: 90.00 → 95.00 from 2026-10-15");
    expect(screen.getByTestId("bizsetting-approve-run-p1")).toBeTruthy();
    expect(screen.getByTestId("bizsetting-reject-run-p1")).toBeTruthy();
    expect(screen.queryByTestId("bizsetting-withdraw-run-p1")).toBeNull();
    expect(screen.getByTestId("bizsetting-withdraw-run-p2")).toBeTruthy();
    expect(screen.queryByTestId("bizsetting-approve-run-p2")).toBeNull();
    expect(screen.queryByTestId("bizsetting-reject-run-p2")).toBeNull();
  });

  it("shows the standard failure when the service refuses the read", async () => {
    await load({ error: "role_not_permitted", message: "This role cannot perform this action." }, 403);
    const error = screen.getByTestId("bizsettings-error");
    expect(error.getAttribute("data-failure-kind")).toBe("forbidden");
    expect(screen.queryByTestId("bizsettings-table")).toBeNull();
    expect(screen.queryByTestId("bizsetting-propose")).toBeNull();
  });

  it("shows a decision refusal through the command failure", async () => {
    await load(admin([proposal({ id: "p1" })]));
    await act(async () => {
      fireEvent.click(screen.getByTestId("bizsetting-approve-run-p1"));
    });
    const call = deferredFetches().find((c) => c.url.endsWith("/decision"))!;
    await act(async () => {
      call.resolve({ error: "segregation_refused", message: "The person who proposed this cannot approve it." }, 409);
    });
    const error = screen.getByTestId("bizsetting-approve-error-p1");
    expect(error.getAttribute("data-failure-kind")).toBe("conflict");
    expect(error.getAttribute("data-failure-code")).toBe("segregation_refused");
    expect(error.textContent).toContain("cannot approve it");
  });

  it("shows the sign-in failure when nobody is signed in, and nothing while identity loads", () => {
    identityState.status = "signed-out";
    cleanup();
    render(<BusinessSettings module={"administration" as never} screen={"business-settings" as never} />);
    expect(screen.getByTestId("bizsettings-error").getAttribute("data-failure-kind")).toBe("session");
    expect(screen.queryByTestId("bizsettings-table")).toBeNull();

    identityState.status = "loading";
    cleanup();
    render(<BusinessSettings module={"administration" as never} screen={"business-settings" as never} />);
    expect(screen.getByTestId("bizsettings-loading")).toBeTruthy();
    expect(screen.queryByTestId("bizsettings-table")).toBeNull();
  });

  it("hides the menu entry from a user without the permission", () => {
    const href = "/app/administration/business-settings";
    expect(runtimeNavFor([{ role: "admin" }], ["fee_rule_manage", "rating_scheme_manage"]).some((r) => r.href === href)).toBe(false);
    expect(runtimeNavFor([{ role: "finance" }]).some((r) => r.href === href)).toBe(false);
    expect(runtimeNavFor([{ role: "laboratory" }], ["business_setting_manage"]).map((r) => r.href)).toEqual([href]);
  });

  it("steps a start date across a month boundary", () => {
    expect(dayAfter("2026-10-04")).toBe("2026-10-05");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
  });
});
