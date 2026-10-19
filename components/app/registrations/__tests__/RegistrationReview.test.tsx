import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationRequest } from "@/components/app/registrations/RegistrationRequest";
import { RegistrationReviews } from "@/components/app/registrations/RegistrationReviews";
import { deferredFetches, installDeferredFetch, type DeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";
import type { Registration } from "@/lib/client/runtimeRegistrations";
import { runtimeNavFor } from "@/lib/runtimeRoutes";

const identity = vi.hoisted(() => ({ status: "signed-in" as "signed-in" | "signed-out" | "loading", role: "programme" }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: (name: string) => (name === "id" ? "reg-1" : null) }),
}));

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ children, action }: { children?: ReactNode; action?: ReactNode }) => <div>{action}{children}</div>,
}));

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () =>
    identity.status === "signed-in"
      ? { status: "signed-in" as const, me: { displayName: "Officer", effectiveRoles: [{ role: identity.role, scope: "all" }], organisations: [] } }
      : { status: identity.status },
  rolesText: (me: { effectiveRoles: { role: string; scope: string }[] }) => me.effectiveRoles.map((r) => r.role).join(", "),
  orgsText: () => "",
  refreshIdentity: () => Promise.resolve({ status: "signed-out" as const }),
}));

const frame = { module: "model-label" as never, screen: "model-dashboard" as never };

function registration(over: Partial<Registration> = {}): Registration {
  return {
    id: "reg-1", reference: "REG-2026-1", kind: "brand", organisation: "Acme", brandName: "Acme Cool",
    state: "programme_review", version: 4, tradeLicenceUploaded: true, ...over,
  };
}

const docs = { items: [], count: 0, authority: "spring-database", localStore: true, verificationNote: "Held in the local store." };
const listOf = (items: Registration[]) => ({ items, count: items.length, authority: "spring-database" });

function mount(node: ReactNode) {
  cleanup();
  installDeferredFetch();
  render(node);
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

describe("registration reviews", () => {
  beforeEach(() => {
    identity.status = "signed-in";
    identity.role = "programme";
    installDeferredFetch();
  });

  it("filters the queue for Programme and for the Officer, and hides the menu from other roles", async () => {
    const items = [
      registration({ id: "a", reference: "REG-2026-1", state: "programme_review" }),
      registration({ id: "b", reference: "REG-2026-2", state: "director_approval", organisation: "Northwind" }),
      registration({ id: "c", reference: "REG-2026-3", state: "approved" }),
      registration({ id: "d", reference: "REG-2026-4", state: "returned" }),
      registration({ id: "e", reference: "REG-2026-5", state: "rejected" }),
    ];
    mount(<RegistrationReviews {...frame} />);
    await resolveAt(0, listOf(items));
    expect(screen.getByTestId("rev-tab-waiting").getAttribute("data-selected")).toBe("true");
    expect(screen.getByTestId("rev-row-REG-2026-1").textContent).toContain("Acme");
    expect(screen.queryByTestId("rev-row-REG-2026-2")).toBeNull();
    expect(screen.queryByTestId("rev-row-REG-2026-3")).toBeNull();

    fireEvent.click(screen.getByTestId("rev-tab-decided"));
    expect(screen.queryByTestId("rev-row-REG-2026-1")).toBeNull();
    expect(screen.getByTestId("rev-row-REG-2026-3")).toBeTruthy();
    expect(screen.getByTestId("rev-row-REG-2026-4").textContent).toContain("Returned");
    expect(screen.getByTestId("rev-row-REG-2026-5").textContent).toContain("Rejected");

    fireEvent.click(screen.getByTestId("rev-tab-all"));
    expect(screen.getByTestId("rev-row-REG-2026-2").textContent).toContain("Northwind");
    expect(screen.getByTestId("rev-open-REG-2026-1").getAttribute("href")).toBe("/app/registrations/request?id=a");

    identity.role = "officer";
    mount(<RegistrationReviews {...frame} />);
    await resolveAt(0, listOf(items));
    expect(screen.getByTestId("rev-row-REG-2026-2")).toBeTruthy();
    expect(screen.queryByTestId("rev-row-REG-2026-1")).toBeNull();

    expect(runtimeNavFor([{ role: "programme" }]).some((r) => r.href === "/app/registrations/reviews")).toBe(true);
    expect(runtimeNavFor([{ role: "officer" }]).some((r) => r.href === "/app/registrations/reviews")).toBe(true);
    for (const role of ["manufacturer", "agency", "finance", "director", "reviewer", "admin"]) {
      expect(runtimeNavFor([{ role }]).some((r) => r.href === "/app/registrations/reviews")).toBe(false);
    }
  });

  it("offers Programme recommend and return, and keeps return disabled until there is a reason", async () => {
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({ trail: [{ action: "confirm_fee", actorRole: "finance", fromState: "fee_due", toState: "programme_review", at: "2026-10-14T09:00:00Z" }] }));
    await resolveAt(1, docs);
    expect(screen.getByTestId("rev-trail-0").textContent).toContain("Fee confirmed");
    expect(screen.getByTestId("rev-trail-0").textContent).toContain("Finance");
    expect(screen.getByTestId("rev-recommend")).toBeTruthy();
    expect((screen.getByTestId("rev-return") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("rev-note-help").textContent).toContain("1 to 500 characters");
    expect(screen.getByTestId("rev-note").getAttribute("aria-describedby")).toBe("rev-note-help");
    expect(screen.queryByTestId("rev-approve")).toBeNull();
    const before = deferredFetches().length;
    fireEvent.click(screen.getByTestId("rev-return"));
    expect(deferredFetches().length).toBe(before);

    await act(async () => {
      fireEvent.click(screen.getByTestId("rev-recommend"));
    });
    const recommend = lastCall((c) => c.url.endsWith("/transition"));
    expect(JSON.parse(String(recommend.init?.body))).toEqual({ action: "recommend", version: 4 });
    await act(async () => {
      recommend.resolve({ registrationId: "reg-1", reference: "REG-2026-1", action: "recommend", fromState: "programme_review", toState: "director_approval", version: 5, actedAt: "2026-10-14T10:00:00Z" });
    });

    fireEvent.change(screen.getByTestId("rev-note"), { target: { value: "Please confirm the brand name." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rev-return"));
    });
    const returned = lastCall((c) => c.url.endsWith("/transition"));
    expect(JSON.parse(String(returned.init?.body))).toEqual({ action: "return", version: 4, note: "Please confirm the brand name." });
    await act(async () => {
      returned.resolve({ registrationId: "reg-1", reference: "REG-2026-1", action: "return", fromState: "programme_review", toState: "returned", version: 5, actedAt: "2026-10-14T10:00:00Z" });
    });
    expect(screen.getByTestId("rev-result").textContent).toContain("Returned");
    expect(screen.getByTestId("rev-result").textContent).toContain("Back to the queue");
  });

  it("offers the Officer approve, return and reject, with the confirmation line", async () => {
    identity.role = "officer";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({ state: "director_approval", kind: "agency", validFrom: "2099-01-01", validTo: "2099-06-01" }));
    await resolveAt(1, docs);
    expect(screen.queryByTestId("rev-recommend")).toBeNull();
    expect(screen.getByTestId("rev-confirm").textContent).toContain("This records the agency's authorisation.");
    expect((screen.getByTestId("rev-approve") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("rev-reject") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("rev-note"), { target: { value: "Noted." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rev-approve"));
    });
    expect(JSON.parse(String(lastCall((c) => c.init?.method === "POST").init?.body))).toEqual({ action: "approve", version: 4, note: "Noted." });

    identity.role = "officer";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({ state: "director_approval" }));
    await resolveAt(1, docs);
    expect(screen.getByTestId("rev-confirm").textContent).toContain("This registers the brand for Acme.");
    fireEvent.change(screen.getByTestId("rev-note"), { target: { value: "The licence does not match." } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("rev-reject"));
    });
    expect(JSON.parse(String(lastCall((c) => c.url.endsWith("/transition")).init?.body))).toEqual({ action: "reject", version: 4, note: "The licence does not match." });
  });

  it("hides the decision panel from a role or a state that has no action", async () => {
    identity.role = "manufacturer";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration());
    await resolveAt(1, docs);
    expect(screen.queryByTestId("rev-decision")).toBeNull();

    identity.role = "programme";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({ state: "director_approval" }));
    await resolveAt(1, docs);
    expect(screen.queryByTestId("rev-decision")).toBeNull();

    identity.role = "finance";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration());
    await resolveAt(1, docs);
    expect(screen.queryByTestId("rev-decision")).toBeNull();
  });

  it("shows each documented refusal in the decision panel", async () => {
    const cases = [
      [403, "segregation_refused", "A person who acted at another stage of this application, or its own organisation, cannot take this step."],
      [403, "role_not_permitted", "This role cannot perform this action."],
      [409, "version_conflict", "The record has changed since it was loaded."],
      [409, "brand_name_taken", "A brand with this name is already registered."],
      [409, "authorisation_overlap", "This agency already holds an authorisation for the brand that overlaps the requested period."],
      [403, "brand_not_permitted", "This brand is not available to your organisation."],
      [422, "document_required", "A trade licence must be uploaded before the registration request can be submitted."],
      [422, "validation_failed", "The request could not be accepted."],
      [404, "not_found", "No such record is available to you."],
    ] as const;
    for (const [status, code, message] of cases) {
      mount(<RegistrationRequest {...frame} />);
      await resolveAt(0, registration());
      await resolveAt(1, docs);
      await act(async () => {
        fireEvent.click(screen.getByTestId("rev-recommend"));
      });
      await act(async () => {
        lastCall((c) => c.url.endsWith("/transition")).resolve({ error: code, message }, status);
      });
      expect(screen.getByTestId("rev-decision-error").textContent).toContain(message);
      if (code === "version_conflict") expect(screen.getByTestId("rev-decision-reload")).toBeTruthy();
    }
  });

  it("shows a returned request's reason, the edit form and a resubmit with no note", async () => {
    identity.role = "manufacturer";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({
      state: "returned",
      trail: [
        { action: "return", actorRole: "programme", fromState: "programme_review", toState: "returned", note: "Use the registered spelling.", at: "2026-10-14T09:00:00Z" },
        { action: "confirm_fee", actorRole: "finance", fromState: "fee_due", toState: "programme_review", at: "2026-10-14T08:00:00Z" },
      ],
    }));
    await resolveAt(1, docs);
    expect(screen.getByTestId("reg-returned").textContent).toContain("Returned by Programme:");
    expect(screen.getByTestId("reg-returned-reason").textContent).toBe("Use the registered spelling.");
    expect(screen.getByTestId("rev-trail-0").textContent).toContain("Returned");
    expect(screen.getByTestId("rev-trail-1").textContent).toContain("Fee confirmed");
    expect(screen.getByTestId("reg-form")).toBeTruthy();
    expect(screen.getByTestId("reg-licence-upload")).toBeTruthy();
    expect((screen.getByTestId("reg-resubmit") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByTestId("reg-brand-name"), { target: { value: "Acme Colder" } });
    expect((screen.getByTestId("reg-resubmit") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("reg-resubmit-help").textContent).toContain("Save or discard");
    fireEvent.change(screen.getByTestId("reg-brand-name"), { target: { value: "Acme Cool" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-resubmit"));
    });
    expect(JSON.parse(String(lastCall((c) => c.url.endsWith("/transition")).init?.body))).toEqual({ action: "resubmit", version: 4 });
  });

  it("shows the registered entry and the rejected reason", async () => {
    identity.role = "manufacturer";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({ state: "approved", registeredBrandId: "11111111-1111-4111-8111-111111111111", trail: [{ action: "approve", actorRole: "director", fromState: "director_approval", toState: "approved", at: "2026-10-14T11:00:00Z" }] }));
    await resolveAt(1, docs);
    expect(screen.getByTestId("reg-registered").textContent).toContain("Registered.");
    expect(screen.getByTestId("reg-registered").textContent).toContain("Acme Cool");
    expect(screen.getByTestId("reg-registered").textContent).toContain("It is on the register.");

    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({
      state: "rejected",
      kind: "agency",
      validFrom: "2099-01-01",
      trail: [{ action: "reject", actorRole: "director", fromState: "director_approval", toState: "rejected", note: "The period overlaps an authorisation.", at: "2026-10-14T11:00:00Z" }],
    }));
    await resolveAt(1, docs);
    expect(screen.getByTestId("reg-rejected").textContent).toContain("Rejected.");
    expect(screen.getByTestId("reg-rejected").textContent).toContain("The period overlaps an authorisation.");
  });

  it("says a returned request was returned even when the trail has no reason", async () => {
    identity.role = "manufacturer";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({ state: "returned" }));
    await resolveAt(1, docs);
    expect(screen.getByTestId("reg-returned").textContent).toContain("Returned for changes");
    expect(screen.getByTestId("reg-resubmit")).toBeTruthy();
  });

  it("shows a Director return as the latest reason", async () => {
    identity.role = "manufacturer";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({
      state: "returned",
      trail: [
        { action: "return", actorRole: "programme", fromState: "programme_review", toState: "returned", note: "First.", at: "2026-10-14T08:00:00Z" },
        { action: "resubmit", actorRole: "manufacturer", fromState: "returned", toState: "programme_review", at: "2026-10-14T09:00:00Z" },
        { action: "return", actorRole: "director", fromState: "director_approval", toState: "returned", note: "Second.", at: "2026-10-14T10:00:00Z" },
      ],
    }));
    await resolveAt(1, docs);
    expect(screen.getByTestId("reg-returned").textContent).toContain("Returned by the Director");
    expect(screen.getByTestId("reg-returned-reason").textContent).toBe("Second.");
  });
});
