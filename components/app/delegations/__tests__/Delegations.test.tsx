import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Delegations } from "@/components/app/delegations/Delegations";
import { deferredFetches, installDeferredFetch, type DeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";
import type { Delegation, Delegations as DelegationsView } from "@/lib/client/runtimeDelegations";
import { runtimeNavFor } from "@/lib/runtimeRoutes";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ children, action }: { children?: ReactNode; action?: ReactNode }) => <div>{action}{children}</div>,
}));

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => ({ status: "signed-in" as const, me: { displayName: "Officer", effectiveRoles: [{ role: "programme", scope: "all" }], organisations: [] } }),
  rolesText: () => "programme",
  orgsText: () => "",
  refreshIdentity: () => Promise.resolve({ status: "signed-out" as const }),
}));

const frame = { module: "model-label" as never, screen: "model-dashboard" as never };

function delegation(over: Partial<Delegation> = {}): Delegation {
  return {
    id: "del-1", delegator: "Programme officer", delegate: "Finance officer", role: "programme", reason: "Away next week.",
    validFrom: "2026-10-15", validTo: "2026-10-20", state: "pending", inForce: false, asDelegator: true, asDelegate: false,
    requestedAt: "2026-10-14T09:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null, revokedBy: null, revokedAt: null, revokeNote: null, uses: 0,
    ...over,
  };
}

function view(over: Partial<DelegationsView> = {}): DelegationsView {
  return {
    today: "2026-10-14",
    canApprove: false,
    delegableRoles: ["programme"],
    colleagues: [
      { id: "col-1", displayName: "Finance officer", roles: ["finance"] },
      { id: "col-2", displayName: "Director colleague", roles: ["director"] },
    ],
    mine: [],
    pending: [],
    decided: [],
    ...over,
  };
}

function mount() {
  cleanup();
  installDeferredFetch();
  render(<Delegations {...frame} />);
}

async function resolveAt(index: number, body: unknown, status = 200) {
  await act(async () => {
    deferredFetches()[index].resolve(body, status);
  });
}

function lastCall(match: (call: DeferredFetch) => boolean) {
  const calls = deferredFetches().filter(match);
  return calls[calls.length - 1];
}

function bodyOf(call: DeferredFetch) {
  return JSON.parse(String(call.init?.body));
}

const posted = (c: DeferredFetch) => c.init?.method === "POST" && c.url === "/api/runtime/delegations";
const decided = (c: DeferredFetch) => c.init?.method === "POST" && c.url.includes("/decision");

describe("delegations", () => {
  beforeEach(() => {
    installDeferredFetch();
  });

  it("offers only the roles and colleagues the API sent, and hides the form and the menu otherwise", async () => {
    mount();
    await resolveAt(0, view({ delegableRoles: ["finance", "programme"] }));
    const roles = [...screen.getByTestId("del-role").querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value);
    const colleagues = [...screen.getByTestId("del-colleague").querySelectorAll("option")].map((o) => (o as HTMLOptionElement).textContent);
    expect(roles).toEqual(["finance", "programme"]);
    expect(colleagues).toEqual(["Finance officer · Finance", "Director colleague · Director"]);
    expect(screen.queryByTestId("del-none")).toBeNull();
    expect(screen.queryByTestId("del-pending")).toBeNull();
    expect(screen.queryByTestId("del-history")).toBeNull();

    mount();
    await resolveAt(0, view({ delegableRoles: [], colleagues: [], canApprove: true }));
    expect(screen.queryByTestId("del-form")).toBeNull();
    expect(screen.getByTestId("del-none").textContent).toBe("You do not hold a role that can be delegated, or you hold more than one stage role");
    expect(screen.getByTestId("del-pending")).toBeTruthy();
    expect(screen.getByTestId("del-history")).toBeTruthy();

    for (const role of ["programme", "director", "finance", "admin"]) {
      expect(runtimeNavFor([{ role }]).some((r) => r.href === "/app/delegations")).toBe(true);
    }
    for (const role of ["manufacturer", "agency", "secretary", "reviewer", "iame"]) {
      expect(runtimeNavFor([{ role }]).some((r) => r.href === "/app/delegations")).toBe(false);
    }
  });

  it("sends the request the person filled in, and explains that the end date is the first day it no longer applies", async () => {
    const data = view();
    mount();
    await resolveAt(0, data);
    expect(screen.getByTestId("del-to-help").textContent).toBe("The delegation applies until the day before this date.");
    expect(screen.getByTestId("del-rules").textContent).toContain("at most 30 days later");
    expect(screen.getByTestId("del-from").getAttribute("min")).toBe("2026-10-14");
    expect(screen.getByTestId("del-to").getAttribute("min")).toBe("2026-10-14");
    fireEvent.change(screen.getByTestId("del-from"), { target: { value: "2026-10-16" } });
    expect(screen.getByTestId("del-to").getAttribute("min")).toBe("2026-10-16");
    expect((screen.getByTestId("del-submit") as HTMLButtonElement).disabled).toBe(true);
    const before = deferredFetches().length;
    fireEvent.click(screen.getByTestId("del-submit"));
    expect(deferredFetches().length).toBe(before);

    fireEvent.change(screen.getByTestId("del-role"), { target: { value: "programme" } });
    fireEvent.change(screen.getByTestId("del-colleague"), { target: { value: "col-2" } });
    fireEvent.change(screen.getByTestId("del-from"), { target: { value: "2026-10-15" } });
    fireEvent.change(screen.getByTestId("del-to"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByTestId("del-reason"), { target: { value: "Away next week." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("del-submit"));
    });
    const call = lastCall(posted);
    expect(bodyOf(call)).toEqual({ delegateId: "col-2", role: "programme", validFrom: "2026-10-15", validTo: "2026-10-20", reason: "Away next week." });
    expect(new Headers(call.init?.headers).get("Idempotency-Key")).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    await resolveAt(deferredFetches().length - 1, delegation(), 201);
    await resolveAt(deferredFetches().length - 1, data);
    expect((screen.getByTestId("del-reason") as HTMLTextAreaElement).value).toBe("");
  });

  it("marks in force separately from approved, and offers withdraw and revoke only where the API says the person may", async () => {
    mount();
    await resolveAt(0, view({
      mine: [
        delegation({ id: "wait", state: "pending", asDelegator: true }),
        delegation({ id: "held", state: "pending", asDelegator: false, asDelegate: true }),
        delegation({ id: "live", state: "approved", inForce: true, asDelegator: true, uses: 2, decidedBy: "Administrator" }),
        delegation({ id: "later", state: "approved", inForce: false, asDelegator: true }),
        delegation({ id: "other", state: "approved", inForce: true, asDelegator: false, asDelegate: true }),
      ],
    }));
    expect(screen.getByTestId("del-state-wait").textContent).toBe("Waiting");
    expect(screen.getByTestId("del-withdraw-wait")).toBeTruthy();
    expect(screen.queryByTestId("del-revoke-wait")).toBeNull();
    expect(screen.getByTestId("del-row-held").textContent).toContain("Delegated to you");
    expect(screen.queryByTestId("del-withdraw-held")).toBeNull();
    expect(screen.queryByTestId("del-revoke-held")).toBeNull();
    expect(screen.getByTestId("del-state-live").textContent).toBe("In force");
    expect(screen.getByTestId("del-row-live").textContent).toContain("You delegated this");
    expect(screen.getByTestId("del-row-live").textContent).toContain("2");
    expect(screen.getByTestId("del-state-later").textContent).toBe("Approved, not in force today");
    expect(screen.queryByTestId("del-revoke-other")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId("del-withdraw-wait"));
    });
    expect(bodyOf(lastCall(decided))).toEqual({ decision: "withdraw" });
    await resolveAt(deferredFetches().length - 1, delegation({ id: "wait", state: "withdrawn" }));

    fireEvent.change(screen.getByTestId("del-revoke-note-live"), { target: { value: "Back early." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("del-revoke-live"));
    });
    expect(bodyOf(lastCall(decided))).toEqual({ decision: "revoke", note: "Back early." });

    mount();
    await resolveAt(0, view({
      canApprove: true,
      delegableRoles: [],
      colleagues: [],
      mine: [delegation({ id: "grant", state: "approved", inForce: true, asDelegator: false, asDelegate: false })],
    }));
    expect(screen.getByTestId("del-revoke-grant")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("del-revoke-grant"));
    });
    expect(bodyOf(lastCall(decided))).toEqual({ decision: "revoke" });
  });

  it("lets an approver approve without a note and reject only once a reason is typed", async () => {
    const pending = delegation({ id: "ask", asDelegator: false, delegator: "Programme officer", delegate: "Finance officer" });
    mount();
    await resolveAt(0, view({ canApprove: true, delegableRoles: [], colleagues: [], pending: [pending] }));
    expect(screen.getByTestId("del-confirm-ask").textContent).toBe("This lets Finance officer act as Programme from 2026-10-15 to the day before 2026-10-20 for Programme officer.");
    expect((screen.getByTestId("del-reject-ask") as HTMLButtonElement).disabled).toBe(true);
    const before = deferredFetches().length;
    fireEvent.click(screen.getByTestId("del-reject-ask"));
    expect(deferredFetches().length).toBe(before);

    fireEvent.change(screen.getByTestId("del-note-ask"), { target: { value: "Not this week." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("del-approve-ask"));
    });
    expect(bodyOf(lastCall(decided))).toEqual({ decision: "approve" });
    await resolveAt(deferredFetches().length - 1, delegation({ id: "ask", state: "approved" }));

    mount();
    await resolveAt(0, view({ canApprove: true, delegableRoles: [], colleagues: [], pending: [pending] }));
    fireEvent.change(screen.getByTestId("del-note-ask"), { target: { value: "Not this week." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("del-reject-ask"));
    });
    expect(bodyOf(lastCall(decided))).toEqual({ decision: "reject", note: "Not this week." });
  });

  it("shows each documented refusal, and reads the screen again when the record is out of date", async () => {
    const staying = [
      { status: 409, error: "delegate_not_eligible", message: "The person you named cannot take this role: they need an active account, a role of their own, and an organisation in common with you." },
      { status: 409, error: "delegation_exists", message: "You already have a delegation of this role to this person that is waiting or in force." },
      { status: 403, error: "role_not_permitted", message: "This role cannot perform this action." },
      { status: 422, error: "validation_failed", message: "The request could not be accepted." },
    ];
    const data = view();
    mount();
    await resolveAt(0, data);
    fireEvent.change(screen.getByTestId("del-from"), { target: { value: "2026-10-15" } });
    fireEvent.change(screen.getByTestId("del-to"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByTestId("del-reason"), { target: { value: "Away next week." } });
    for (const refusal of staying) {
      const before = deferredFetches().length;
      await act(async () => {
        fireEvent.click(screen.getByTestId("del-submit"));
      });
      await resolveAt(deferredFetches().length - 1, { error: refusal.error, message: refusal.message }, refusal.status);
      expect(deferredFetches().length).toBe(before + 1);
      expect(screen.getByTestId("del-request-error").textContent).toContain(refusal.message);
      expect(screen.getByTestId("del-request-error").textContent).not.toContain("Reload the latest version");
    }

    const before = deferredFetches().length;
    await act(async () => {
      fireEvent.click(screen.getByTestId("del-submit"));
    });
    await resolveAt(deferredFetches().length - 1, { error: "not_found", message: "No such record is available to you." }, 404);
    expect(deferredFetches().length).toBe(before + 2);
    expect(screen.getByTestId("del-request-error").textContent).toContain("No such record is available to you.");
    await resolveAt(deferredFetches().length - 1, { ...data });
    // On the ask form the message stays after the re-read, until the person changes something (the decision rows below clear theirs).
    expect(screen.getByTestId("del-request-error").textContent).toContain("No such record is available to you.");
    fireEvent.change(screen.getByTestId("del-reason"), { target: { value: "Away next week, again." } });
    expect(screen.queryByTestId("del-request-error")).toBeNull();

    const pending = view({ canApprove: true, delegableRoles: [], colleagues: [], pending: [delegation({ id: "ask", asDelegator: false })] });
    const decisions = [
      { status: 403, error: "segregation_refused", message: "A person who acted at another stage of this application, or its own organisation, cannot take this step.", again: false },
      { status: 409, error: "proposal_not_pending", message: "This proposal has already been decided or withdrawn.", again: true },
      { status: 409, error: "delegation_not_active", message: "This delegation is not in force, so it cannot be revoked.", again: true },
      { status: 409, error: "effective_date_passed", message: "The date this rule was to start has passed; propose it again with a later date.", again: true },
    ];
    for (const refusal of decisions) {
      mount();
      await resolveAt(0, pending);
      const count = deferredFetches().length;
      await act(async () => {
        fireEvent.click(screen.getByTestId("del-approve-ask"));
      });
      await resolveAt(deferredFetches().length - 1, { error: refusal.error, message: refusal.message }, refusal.status);
      expect(screen.getByTestId("del-decide-error").textContent).toContain(refusal.message);
      if (refusal.again) {
        expect(deferredFetches().length).toBe(count + 2);
        await resolveAt(deferredFetches().length - 1, { ...pending, pending: [...pending.pending] });
        expect(screen.queryByTestId("del-decide-error")).toBeNull();
      } else {
        expect(deferredFetches().length).toBe(count + 1);
      }
    }
  });

  it("lists decided delegations for an approver", async () => {
    mount();
    await resolveAt(0, view({
      canApprove: true,
      delegableRoles: [],
      colleagues: [],
      decided: [
        delegation({ id: "hist-1", state: "rejected", inForce: false, decidedBy: "Administrator", decidedAt: "2026-10-14T11:00:00Z", decisionNote: "Not this week." }),
        delegation({ id: "hist-2", state: "revoked", inForce: false, revokedBy: "Programme officer", revokedAt: "2026-10-14T12:00:00Z", revokeNote: "Back early." }),
      ],
    }));
    expect(screen.getByTestId("del-history-hist-1").textContent).toContain("Rejected");
    expect(screen.getByTestId("del-history-hist-1").textContent).toContain("Administrator");
    expect(screen.getByTestId("del-history-hist-1").textContent).toContain("Not this week.");
    expect(screen.getByTestId("del-history-hist-2").textContent).toContain("Revoked");
    expect(screen.getByTestId("del-history-hist-2").textContent).toContain("Back early.");
  });

  it("keeps a refusal beside the ask form until the person changes something", async () => {
    const data = view();
    mount();
    await resolveAt(0, data);
    fireEvent.change(screen.getByTestId("del-from"), { target: { value: "2026-10-15" } });
    fireEvent.change(screen.getByTestId("del-to"), { target: { value: "2026-10-20" } });
    fireEvent.change(screen.getByTestId("del-reason"), { target: { value: "Away." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("del-submit"));
    });
    await act(async () => {
      lastCall(posted).resolve({ error: "effective_date_passed", message: "The date this rule was to start has passed; propose it again with a later date." }, 409);
    });
    expect(screen.getByTestId("del-request-error").textContent).toContain("has passed");
    await resolveAt(deferredFetches().length - 1, data);
    expect(screen.getByTestId("del-request-error").textContent).toContain("has passed");
    expect(screen.getByTestId("del-request-error").getAttribute("role")).toBe("alert");
    fireEvent.change(screen.getByTestId("del-from"), { target: { value: "2026-10-16" } });
    expect(screen.queryByTestId("del-request-error")).toBeNull();
  });

  it("states the end date as not included in the table and in the approver's line", async () => {
    mount();
    await resolveAt(0, view({
      canApprove: true,
      mine: [delegation({ id: "m1", state: "approved", inForce: true, asDelegator: true })],
      pending: [delegation({ id: "p1" })],
    }));
    expect(screen.getByText("Ends on (not included)")).toBeTruthy();
    expect(screen.getByTestId("del-confirm-p1").textContent).toContain("to the day before");
    expect(screen.getByTestId("del-reason-help").textContent).toContain("1 to 500");
    expect(screen.getByTestId("del-reject-p1").getAttribute("aria-describedby")).toBe("del-note-help-p1");
  });
});
