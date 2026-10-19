import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegisterRevocations } from "@/components/app/registrations/RegisterRevocations";
import { deferredFetches, installDeferredFetch, type DeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";
import type { RegisterRevocations as Register, RegisterRevocationProposal } from "@/lib/client/runtimeRegisterRevocations";
import { runtimeNavFor } from "@/lib/runtimeRoutes";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search.value) }));
vi.mock("@/lib/client/runtimeManufacturers", async (orig) => ({
  ...(await orig<typeof import("@/lib/client/runtimeManufacturers")>()),
  useManufacturers: () => ({ phase: "loading" }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ children, action }: { children?: ReactNode; action?: ReactNode }) => <div>{action}{children}</div>,
}));

const identity = vi.hoisted(() => ({
  state: {
    status: "signed-in" as const,
    me: { displayName: "Officer", effectiveRoles: [{ role: "programme", scope: "all" }], organisations: [], adminDemonstrationReadOnly: false as boolean | undefined },
  },
}));

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => identity.state,
  rolesText: () => "programme",
  orgsText: () => "",
  refreshIdentity: () => Promise.resolve({ status: "signed-out" as const }),
}));

vi.mock("@/lib/adminDemonstration", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/adminDemonstration")>();
  return {
    ...mod,
    useAdminDemonstrationReadOnly: () =>
      identity.state.status === "signed-in" && identity.state.me.adminDemonstrationReadOnly === true,
  };
});

const frame = { module: "model-label" as never, screen: "model-dashboard" as never };

function proposal(over: Partial<RegisterRevocationProposal> = {}): RegisterRevocationProposal {
  return {
    id: "prop-1", targetKind: "brand", targetId: "brand-active", targetLabel: "Acme Cool", action: "revoke", closeOn: null,
    reason: "The owner asked.", state: "pending", proposedBy: "Programme officer", proposedByYou: false,
    proposedAt: "2026-10-14T09:00:00Z", decidedBy: null, decidedAt: null, decisionNote: null, ...over,
  };
}

function register(over: Partial<Register> = {}): Register {
  return {
    today: "2026-10-14",
    canPropose: true,
    canDecide: false,
    brands: [
      { id: "brand-active", name: "Acme Cool", owner: "NOVA", status: "active", source: "REG-2026-1" },
      { id: "brand-suspended", name: "Held", owner: "NOVA", status: "suspended", source: "REG-2026-2" },
      { id: "brand-revoked", name: "Gone", owner: "NOVA", status: "revoked", source: "REG-2026-3" },
    ],
    authorisations: [
      { id: "auth-active", brandId: "brand-active", brandName: "Acme Cool", agency: "PIXEL", principal: "NOVA", validFrom: "2026-01-01", validTo: "2026-12-31", status: "active", source: "REG-2026-4" },
      { id: "auth-revoked", brandId: "brand-active", brandName: "Acme Cool", agency: "OLD", principal: "NOVA", validFrom: "2025-01-01", validTo: null, status: "revoked", source: "REG-2026-5" },
    ],
    pending: [],
    decided: [],
    ...over,
  };
}

function mount() {
  cleanup();
  installDeferredFetch();
  render(<RegisterRevocations {...frame} />);
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

const posted = (c: DeferredFetch) => c.init?.method === "POST" && c.url === "/api/runtime/register-revocations";
const decided = (c: DeferredFetch) => c.init?.method === "POST" && c.url.includes("/decision");

describe("register revocations", () => {
  beforeEach(() => {
    identity.state = {
      status: "signed-in",
      me: { displayName: "Officer", effectiveRoles: [{ role: "programme", scope: "all" }], organisations: [], adminDemonstrationReadOnly: false },
    };
    installDeferredFetch();
  });

  it("pages, searches, filters and sorts the register, and shows a summary", async () => {
    mount();
    const brands = Array.from({ length: 12 }, (_, i) => ({
      id: `b${i}`, name: `Brand ${String(i).padStart(2, "0")}`, owner: i % 2 ? "NOVA" : "PIXEL", status: (i % 4 === 3 ? "suspended" : "active") as "active" | "suspended", source: "REG",
    }));
    await resolveAt(0, register({ brands }));
    expect(screen.getByTestId("rvk-card-brands").textContent).toContain("12");
    expect(screen.getByTestId("rvk-card-brands").textContent).toContain("9 active, 3 suspended");
    expect(screen.getAllByTestId(/^rvk-brand-b/).length).toBe(8);
    expect(screen.getAllByTestId("list-pagination")[0].textContent).toContain("Showing 1–8 of 12");
    fireEvent.change(screen.getByTestId("rvk-brand-status"), { target: { value: "suspended" } });
    expect(screen.getAllByTestId(/^rvk-brand-b/).length).toBe(3);
    fireEvent.change(screen.getByTestId("rvk-brand-owner"), { target: { value: "PIXEL" } });
    expect(screen.queryAllByTestId(/^rvk-brand-b/).length).toBe(0);
    expect(screen.getByTestId("rvk-brands").textContent).toContain("No brand matches these filters.");
    fireEvent.click(screen.getByTestId("rvk-brand-clear"));
    fireEvent.change(screen.getAllByTestId("list-search")[0], { target: { value: "Brand 07" } });
    expect(screen.getAllByTestId(/^rvk-brand-b/).length).toBe(1);
    fireEvent.click(screen.getAllByTestId("list-clear")[0]);
    fireEvent.click(screen.getAllByTestId("list-sort-name")[0]);
    fireEvent.click(screen.getAllByTestId("list-sort-name")[0]);
    expect(screen.getAllByTestId(/^rvk-brand-b/)[0].textContent).toContain("Brand 11");
  });

  it("shows the register in words, and a Propose button only on an active row when the API allows a proposal", async () => {
    mount();
    await resolveAt(0, register());
    expect(screen.getByTestId("rvk-brand-brand-active").textContent).toContain("Active");
    expect(screen.getByTestId("rvk-brand-brand-suspended").textContent).toContain("Suspended");
    expect(screen.getByTestId("rvk-brand-brand-revoked").textContent).toContain("Revoked");
    expect(screen.getByTestId("rvk-auth-auth-active").textContent).toContain("PIXEL");
    expect(screen.getByTestId("rvk-auth-auth-active").textContent).toContain("Active");
    expect(screen.getByTestId("rvk-auth-auth-revoked").textContent).toContain("Revoked");
    expect(screen.getByTestId("rvk-propose-brand-active")).toBeTruthy();
    expect(screen.getByTestId("rvk-propose-auth-active")).toBeTruthy();
    expect(screen.queryByTestId("rvk-propose-brand-suspended")).toBeNull();
    expect(screen.queryByTestId("rvk-propose-brand-revoked")).toBeNull();
    expect(screen.queryByTestId("rvk-propose-auth-revoked")).toBeNull();

    mount();
    await resolveAt(0, register({ canPropose: false, canDecide: true }));
    expect(screen.queryByTestId("rvk-propose-brand-active")).toBeNull();
    expect(screen.queryByTestId("rvk-propose-auth-active")).toBeNull();

    expect(runtimeNavFor([{ role: "programme" }]).some((r) => r.href === "/app/registrations/register")).toBe(true);
    expect(runtimeNavFor([{ role: "officer" }]).some((r) => r.href === "/app/registrations/register")).toBe(true);
    for (const role of ["manufacturer", "agency", "finance", "director", "reviewer", "admin"]) {
      expect(runtimeNavFor([{ role }]).some((r) => r.href === "/app/registrations/register")).toBe(false);
    }
  });

  it("sends a brand revocation, an authorisation revocation and a closure, and keeps submit disabled until there is a reason", async () => {
    const data = register();
    mount();
    await resolveAt(0, data);
    fireEvent.click(screen.getByTestId("rvk-propose-brand-active"));
    expect(screen.getByTestId("rvk-panel").textContent).toContain("Revoke this brand (its authorisations will be revoked with it)");
    expect(screen.queryByTestId("rvk-action")).toBeNull();
    expect((screen.getByTestId("rvk-submit") as HTMLButtonElement).disabled).toBe(true);
    const before = deferredFetches().length;
    fireEvent.click(screen.getByTestId("rvk-submit"));
    expect(deferredFetches().length).toBe(before);

    fireEvent.change(screen.getByTestId("rvk-reason"), { target: { value: "The owner asked." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rvk-submit"));
    });
    const brand = lastCall(posted);
    expect(bodyOf(brand)).toEqual({ targetKind: "brand", targetId: "brand-active", action: "revoke", reason: "The owner asked." });
    expect(brand.init?.headers && new Headers(brand.init.headers).get("Idempotency-Key")).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    await resolveAt(deferredFetches().length - 1, proposal(), 201);
    await resolveAt(deferredFetches().length - 1, data);

    fireEvent.click(screen.getByTestId("rvk-propose-auth-active"));
    fireEvent.change(screen.getByTestId("rvk-reason"), { target: { value: "The agency stopped." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rvk-submit"));
    });
    expect(bodyOf(lastCall(posted))).toEqual({ targetKind: "authorisation", targetId: "auth-active", action: "revoke", reason: "The agency stopped." });
    await resolveAt(deferredFetches().length - 1, proposal({ targetKind: "authorisation", action: "revoke" }), 201);
    await resolveAt(deferredFetches().length - 1, data);

    fireEvent.click(screen.getByTestId("rvk-propose-auth-active"));
    fireEvent.change(screen.getByTestId("rvk-action"), { target: { value: "close" } });
    expect(screen.getByTestId("rvk-close-rule").textContent).toContain("not before today");
    expect(screen.getByTestId("rvk-close-rule").textContent).toContain("2026-01-01");
    expect(screen.getByTestId("rvk-close-rule").textContent).toContain("2026-12-31");
    fireEvent.change(screen.getByTestId("rvk-reason"), { target: { value: "Close at the end of the season." } });
    expect((screen.getByTestId("rvk-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("rvk-close-on"), { target: { value: "2026-11-01" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rvk-submit"));
    });
    expect(bodyOf(lastCall(posted))).toEqual({
      targetKind: "authorisation", targetId: "auth-active", action: "close", closeOn: "2026-11-01", reason: "Close at the end of the season.",
    });
  });

  it("lets the Director approve or reject, shows a proposer's own row without those buttons, and lets the proposer withdraw", async () => {
    mount();
    await resolveAt(0, register({
      canPropose: false,
      canDecide: true,
      pending: [
        proposal(),
        proposal({ id: "prop-close", targetKind: "authorisation", action: "close", closeOn: "2026-11-01", targetLabel: "PIXEL for Acme Cool" }),
        proposal({ id: "prop-yours", proposedByYou: true }),
      ],
    }));
    expect(screen.getByTestId("rvk-confirm-prop-1").textContent).toBe("This revokes the brand and its authorisations");
    expect(screen.getByTestId("rvk-confirm-prop-close").textContent).toBe("This closes the authorisation on 2026-11-01");
    expect((screen.getByTestId("rvk-approve-prop-1") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("rvk-reject-prop-1") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("rvk-approve-prop-yours")).toBeNull();
    expect(screen.queryByTestId("rvk-reject-prop-yours")).toBeNull();
    expect(screen.getByTestId("rvk-yours-prop-yours").textContent).toBe("You proposed this; another person decides");
    expect(screen.queryByTestId("rvk-withdraw-prop-yours")).toBeNull();

    const before = deferredFetches().length;
    fireEvent.click(screen.getByTestId("rvk-reject-prop-1"));
    expect(deferredFetches().length).toBe(before);

    await act(async () => {
      fireEvent.click(screen.getByTestId("rvk-approve-prop-1"));
    });
    expect(bodyOf(lastCall(decided))).toEqual({ decision: "approve" });
    await resolveAt(deferredFetches().length - 1, proposal({ state: "approved" }));

    fireEvent.change(screen.getByTestId("rvk-note-prop-1"), { target: { value: "The record is still needed." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rvk-reject-prop-1"));
    });
    expect(bodyOf(lastCall(decided))).toEqual({ decision: "reject", note: "The record is still needed." });

    mount();
    await resolveAt(0, register({ canPropose: true, canDecide: false, pending: [proposal({ proposedByYou: true })] }));
    expect(screen.queryByTestId("rvk-approve-prop-1")).toBeNull();
    expect(screen.getByTestId("rvk-yours-prop-1")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("rvk-withdraw-prop-1"));
    });
    expect(bodyOf(lastCall(decided))).toEqual({ decision: "withdraw" });
  });

  it("shows each documented refusal in the contract's words, and does not offer a reload", async () => {
    const refusals: { status: number; error: string; message: string }[] = [
      { status: 409, error: "revocation_pending", message: "A closure or revocation is already proposed for this record." },
      { status: 409, error: "target_not_active", message: "This record is no longer active, or the closing date does not fit its period." },
      { status: 403, error: "role_not_permitted", message: "This role cannot perform this action." },
      { status: 422, error: "validation_failed", message: "The request could not be accepted." },
      { status: 404, error: "not_found", message: "No such record is available to you." },
    ];
    mount();
    await resolveAt(0, register());
    fireEvent.click(screen.getByTestId("rvk-propose-brand-active"));
    fireEvent.change(screen.getByTestId("rvk-reason"), { target: { value: "The owner asked." } });
    for (const refusal of refusals) {
      await act(async () => {
        fireEvent.click(screen.getByTestId("rvk-submit"));
      });
      await resolveAt(deferredFetches().length - 1, { error: refusal.error, message: refusal.message }, refusal.status);
      expect(screen.getByTestId("rvk-propose-error").textContent).toContain(refusal.message);
      expect(screen.getByTestId("rvk-propose-error").textContent).not.toContain("Reload the latest version");
    }

    mount();
    await resolveAt(0, register({ canPropose: false, canDecide: true, pending: [proposal()] }));
    const decisions = [
      { status: 403, error: "segregation_refused", message: "A person who acted at another stage of this application, or its own organisation, cannot take this step." },
      { status: 409, error: "proposal_not_pending", message: "This proposal has already been decided or withdrawn." },
      { status: 409, error: "closing_date_passed", message: "The closing date has passed; propose the closure again with a later date." },
    ];
    for (const refusal of decisions) {
      await act(async () => {
        fireEvent.click(screen.getByTestId("rvk-approve-prop-1"));
      });
      await resolveAt(deferredFetches().length - 1, { error: refusal.error, message: refusal.message }, refusal.status);
      expect(screen.getByTestId("rvk-decide-error").textContent).toContain(refusal.message);
      expect(screen.getByTestId("rvk-decide-error").textContent).not.toContain("Reload the latest version");
    }
  });

  it("lists decided proposals with their state, who decided, when, and the note", async () => {
    mount();
    await resolveAt(0, register({
      decided: [
        proposal({ id: "hist-1", state: "approved", decidedBy: "Director", decidedAt: "2026-10-14T11:00:00Z", decisionNote: null }),
        proposal({ id: "hist-2", state: "rejected", decidedBy: "Director", decidedAt: "2026-10-14T12:00:00Z", decisionNote: "Not this season." }),
        proposal({ id: "hist-3", state: "withdrawn", decidedBy: "Programme officer", decidedAt: "2026-10-14T13:00:00Z", decisionNote: null }),
      ],
    }));
    expect(screen.getByTestId("rvk-history-hist-1").textContent).toContain("Approved");
    expect(screen.getByTestId("rvk-history-hist-1").textContent).toContain("Director");
    expect(screen.getByTestId("rvk-history-hist-1").textContent).toContain("2026-10-14 16:30:00");
    expect(screen.getByTestId("rvk-history-hist-2").textContent).toContain("Rejected");
    expect(screen.getByTestId("rvk-history-hist-2").textContent).toContain("Not this season.");
    expect(screen.getByTestId("rvk-history-hist-3").textContent).toContain("Withdrawn");
    expect(screen.getByTestId("rvk-history-hist-3").textContent).toContain("Programme officer");
  });

  it("reads the register again after a refusal that means it moved on, and does not carry a panel from one row to the next", async () => {
    mount();
    await resolveAt(0, register({ canPropose: true, canDecide: true, pending: [proposal({ id: "prop-9", proposedByYou: false })] }));
    const reads = () => deferredFetches().filter((c) => c.url === "/api/runtime/register-revocations" && c.init?.method !== "POST").length;
    const before = reads();
    fireEvent.change(screen.getByTestId("rvk-note-prop-9"), { target: { value: "Not warranted" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rvk-reject-prop-9"));
    });
    await act(async () => {
      lastCall(decided).resolve({ error: "proposal_not_pending", message: "This proposal has already been decided or withdrawn." }, 409);
    });
    expect(screen.getByTestId("rvk-decide-error").textContent).toContain("already been decided or withdrawn");
    expect(reads()).toBe(before + 1);

    mount();
    await resolveAt(0, register({ canPropose: true }));
    fireEvent.click(screen.getByTestId("rvk-propose-brand-active"));
    fireEvent.change(screen.getByTestId("rvk-reason"), { target: { value: "Typed for the first row" } });
    fireEvent.click(screen.getByTestId("rvk-propose-auth-active"));
    expect((screen.getByTestId("rvk-reason") as HTMLTextAreaElement).value).toBe("");
  });

  it("sends a note only with a rejection, never with an approval", async () => {
    mount();
    await resolveAt(0, register({ canPropose: false, canDecide: true, pending: [proposal({ id: "prop-8" })] }));
    fireEvent.change(screen.getByTestId("rvk-note-prop-8"), { target: { value: "Typed for a rejection" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rvk-approve-prop-8"));
    });
    expect(bodyOf(lastCall(decided))).toEqual({ decision: "approve" });
    await act(async () => {
      lastCall(decided).resolve({ error: "segregation_refused", message: "x" }, 403);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rvk-reject-prop-8"));
    });
    expect(bodyOf(lastCall(decided))).toEqual({ decision: "reject", note: "Typed for a rejection" });
  });

  it("read-only Admin hides revocation mutation controls", async () => {
    identity.state = {
      status: "signed-in",
      me: { displayName: "Admin", effectiveRoles: [{ role: "admin", scope: "all" }], organisations: [], adminDemonstrationReadOnly: true },
    };
    mount();
    await resolveAt(
      0,
      register({
        canPropose: true,
        canDecide: true,
        pending: [proposal({ id: "prop-admin", proposedByYou: false }), proposal({ id: "prop-yours", proposedByYou: true })],
      }),
    );
    expect(screen.queryByTestId("rvk-propose-brand-active")).toBeNull();
    expect(screen.queryByTestId("rvk-propose-auth-active")).toBeNull();
    expect(screen.queryByTestId("rvk-approve-prop-admin")).toBeNull();
    expect(screen.queryByTestId("rvk-reject-prop-admin")).toBeNull();
    expect(screen.queryByTestId("rvk-withdraw-prop-yours")).toBeNull();
  });
});
