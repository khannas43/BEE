import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationList } from "@/components/app/registrations/RegistrationList";
import { RegistrationNew } from "@/components/app/registrations/RegistrationNew";
import { RegistrationRequest } from "@/components/app/registrations/RegistrationRequest";
import { deferredFetches, installDeferredFetch, type DeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";
import type { Registration } from "@/lib/client/runtimeRegistrations";
import { runtimeNavFor } from "@/lib/runtimeRoutes";

const identity = vi.hoisted(() => ({ status: "signed-in" as "signed-in" | "signed-out" | "loading", role: "manufacturer" }));
const nav = vi.hoisted(() => ({ push: vi.fn(), id: null as string | null }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  useSearchParams: () => ({ get: (name: string) => (name === "id" ? nav.id : null) }),
}));

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div data-testid="screen-chrome">{children}</div>,
  Card: ({ children, action }: { children?: ReactNode; action?: ReactNode }) => (
    <div>{action}{children}</div>
  ),
}));

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () =>
    identity.status === "signed-in"
      ? { status: "signed-in" as const, me: { displayName: "Applicant", effectiveRoles: [{ role: identity.role, scope: "own-org" }], organisations: [] } }
      : { status: identity.status },
  rolesText: (me: { effectiveRoles: { role: string; scope: string }[] }) => me.effectiveRoles.map((r) => `${r.role} (${r.scope})`).join(", "),
  orgsText: () => "",
  refreshIdentity: () => Promise.resolve({ status: "signed-out" as const }),
}));

const fee = {
  amountInr: "5000.00", taxRatePercent: "0.00", taxInr: "0.00", totalInr: "5000.00", currency: "INR",
  feeRuleKey: "REG:brand_registration", feeRuleVersion: 1, verificationStatus: "synthetic", localDemoFee: true,
  label: "Local demo fee, not BEE-approved",
};

function registration(over: Partial<Registration> = {}): Registration {
  return {
    id: "reg-1", reference: "REG-2026-1", kind: "brand", organisation: "Acme", brandName: "Acme Cool",
    state: "draft", version: 3, tradeLicenceUploaded: false, ...over,
  };
}

const listOf = (items: Registration[]) => ({ items, count: items.length, authority: "spring-database" });

const emptyDocs = {
  items: [], count: 0, authority: "spring-database", localStore: true,
  verificationNote: "Held in the local store until a checker is appointed.",
};

const licenceDocs = {
  ...emptyDocs,
  count: 1,
  items: [{
    id: "doc-1", documentKind: "trade_licence", verificationStatus: "pending_local_verification",
    verificationNote: "Held in the local store until a checker is appointed.",
    versions: [{
      id: "ver-2", versionNumber: 2, contentSha256: "abc", sizeBytes: 12, mediaType: "application/pdf",
      originalFilename: "licence.pdf", label: "Trade licence", uploadedByAccountId: "acct",
      uploadedAt: "2026-10-14T00:00:00Z", verificationStatus: "pending_local_verification",
    }],
  }],
};

function preview(met: boolean[], withFee = true) {
  const codes = ["trade_licence_uploaded", "start_date_set", "brand_active", "brand_name_free"] as const;
  return {
    ready: met.every(Boolean), version: 3, intakeNote: "Provisional local rules.",
    gates: codes.map((code, i) => ({ code, met: met[i] ?? false })),
    ...(withFee ? { submissionFee: fee } : {}),
  };
}

const frame = { module: "model-label" as never, screen: "model-dashboard" as never };

async function resolveAt(index: number, body: unknown, status = 200) {
  await act(async () => {
    deferredFetches()[index].resolve(body, status);
  });
}

function mount(node: ReactNode) {
  cleanup();
  installDeferredFetch();
  render(node);
}

function lastCall(match: (call: DeferredFetch) => boolean) {
  const calls = deferredFetches().filter(match);
  return calls[calls.length - 1];
}

describe("registration screens", () => {
  beforeEach(() => {
    identity.status = "signed-in";
    identity.role = "manufacturer";
    nav.id = null;
    nav.push.mockReset();
    installDeferredFetch();
  });

  it("lists a request with its reference, kind, state and fee, and offers a new request", async () => {
    mount(<RegistrationList {...frame} />);
    expect(screen.getByTestId("reg-list-loading")).toBeTruthy();
    await resolveAt(0, listOf([registration(), registration({ id: "reg-2", reference: "REG-2026-2", kind: "agency", brandName: "Northwind", state: "fee_due", submissionFee: fee })]));
    expect(screen.getByTestId("reg-row-REG-2026-1").textContent).toContain("Brand");
    expect(screen.getByTestId("reg-row-REG-2026-1").textContent).toContain("Draft");
    expect(screen.getByTestId("reg-row-REG-2026-1").textContent).toContain("No fee yet");
    expect(screen.getByTestId("reg-open-REG-2026-1").getAttribute("href")).toBe("/app/registrations/request?id=reg-1");
    const due = screen.getByTestId("reg-row-REG-2026-2");
    expect(due.textContent).toContain("Agency");
    expect(due.textContent).toContain("Fee due");
    expect(due.textContent).toContain("INR 5000.00");
    expect(due.textContent).toContain("Local demo fee, not BEE-approved");
    expect(screen.getByTestId("reg-new").getAttribute("href")).toBe("/app/registrations/new");
  });

  it("shows an empty list, a signed-out refusal and a role refusal through the kit", async () => {
    mount(<RegistrationList {...frame} />);
    await resolveAt(0, listOf([]));
    expect(screen.getByTestId("reg-list-empty").textContent).toContain("No registration request exists yet.");
    expect(screen.getByTestId("reg-new")).toBeTruthy();

    identity.status = "signed-out";
    mount(<RegistrationList {...frame} />);
    expect(screen.getByTestId("reg-list-error").textContent).toContain("Sign in to continue.");

    identity.status = "signed-in";
    mount(<RegistrationList {...frame} />);
    await resolveAt(0, { error: "role_not_permitted", message: "This role cannot perform this action." }, 403);
    expect(screen.getByTestId("reg-list-error").textContent).toContain("This role has no read access to model applications.");
  });

  it("shows a manufacturer the brand-name rule and sends a draft without a version", async () => {
    mount(<RegistrationNew {...frame} />);
    expect(screen.getByTestId("reg-form").textContent).toContain("Register a brand");
    expect(screen.getByTestId("reg-brand-rule").textContent).toContain("1 to 120 letters, digits, space and . & ' ( ) / _ -");
    expect(screen.queryByTestId("reg-brand-choice")).toBeNull();
    const before = deferredFetches().length;
    fireEvent.change(screen.getByTestId("reg-brand-name"), { target: { value: " " } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-save"));
    });
    expect(screen.getByTestId("reg-form-input-error")).toBeTruthy();
    expect(deferredFetches().length).toBe(before);

    fireEvent.change(screen.getByTestId("reg-brand-name"), { target: { value: "Acme Cool" } });
    expect(screen.getByTestId("reg-dirty")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-save"));
    });
    const call = deferredFetches().find((c) => c.url === "/api/runtime/registrations" && c.init?.method === "POST")!;
    expect(JSON.parse(String(call.init?.body))).toEqual({ brandName: "Acme Cool" });
    expect(call.init?.headers && new Headers(call.init.headers).get("Idempotency-Key")).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    await act(async () => {
      call.resolve(registration({ reference: "REG-2026-9" }), 201);
    });
    expect(nav.push).toHaveBeenCalledWith("/app/registrations/request?id=reg-1");
  });

  it("shows an agency the brands it may act for and sends the start date", async () => {
    identity.role = "agency";
    mount(<RegistrationNew {...frame} />);
    expect(screen.getByTestId("reg-form").textContent).toContain("Ask to act for a brand");
    await resolveAt(0, { items: [{ brandId: "b1", brandName: "Northwind", principalOrganisation: "Northwind Pvt" }], count: 1, authority: "spring-database" });
    expect(screen.getByTestId("reg-brand-choice").textContent).toContain("Northwind · Northwind Pvt");
    fireEvent.change(screen.getByTestId("reg-brand-choice"), { target: { value: "b1" } });
    fireEvent.change(screen.getByTestId("reg-valid-from"), { target: { value: "2099-01-01" } });
    fireEvent.change(screen.getByTestId("reg-valid-to"), { target: { value: "2099-06-01" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-save"));
    });
    const call = deferredFetches().find((c) => c.init?.method === "POST")!;
    expect(JSON.parse(String(call.init?.body))).toEqual({ brandId: "b1", validFrom: "2099-01-01", validTo: "2099-06-01" });
  });

  it("shows brand_name_taken, duplicate_registration, version_conflict, not_editable and validation_failed", async () => {
    mount(<RegistrationNew {...frame} />);
    fireEvent.change(screen.getByTestId("reg-brand-name"), { target: { value: "Acme Cool" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-save"));
    });
    await act(async () => {
      deferredFetches().at(-1)!.resolve({ error: "brand_name_taken", message: "A brand with this name is already registered." }, 409);
    });
    expect(screen.getByTestId("reg-save-error").textContent).toContain("A brand with this name is already registered.");

    mount(<RegistrationNew {...frame} />);
    fireEvent.change(screen.getByTestId("reg-brand-name"), { target: { value: "Acme Cool" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-save"));
    });
    await act(async () => {
      deferredFetches().at(-1)!.resolve({ error: "duplicate_registration", message: "A registration request for this brand has already been filed by your organisation." }, 409);
    });
    expect(screen.getByTestId("reg-save-error").textContent).toContain("A registration request for this brand has already been filed by your organisation.");

    mount(<RegistrationNew {...frame} />);
    fireEvent.change(screen.getByTestId("reg-brand-name"), { target: { value: "Acme Cool" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-save"));
    });
    await act(async () => {
      deferredFetches().at(-1)!.resolve({ error: "validation_failed", message: "The request could not be accepted." }, 422);
    });
    expect(screen.getByTestId("reg-save-error").textContent).toContain("The request could not be accepted.");

    nav.id = "reg-1";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration());
    await resolveAt(1, emptyDocs);
    fireEvent.change(screen.getByTestId("reg-brand-name"), { target: { value: "Acme Cooler" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-save"));
    });
    const patch = deferredFetches().find((c) => c.init?.method === "PATCH")!;
    expect(JSON.parse(String(patch.init?.body))).toEqual({ brandName: "Acme Cooler", version: 3 });
    await act(async () => {
      patch.resolve({ error: "version_conflict", message: "The record has changed since it was loaded." }, 409);
    });
    expect(screen.getByTestId("reg-save-error").textContent).toContain("The record has changed since it was loaded.");
    expect(screen.getByTestId("reg-save-reload")).toBeTruthy();

    fireEvent.change(screen.getByTestId("reg-brand-name"), { target: { value: "Acme Cold" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-save"));
    });
    await act(async () => {
      deferredFetches().at(-1)!.resolve({ error: "not_editable", message: "Only draft applications can be edited." }, 403);
    });
    expect(screen.getByTestId("reg-save-error").textContent).toContain("Only draft applications can be edited.");
  });

  it("shows the licence card and the API message when the file is not a PDF", async () => {
    nav.id = "reg-1";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration());
    await resolveAt(1, licenceDocs);
    expect(screen.getByTestId("reg-licence-version-2").textContent).toContain("licence.pdf");
    expect(screen.getByTestId("reg-licence-download-2").getAttribute("href")).toContain("/documents/doc-1/versions/ver-2/content");
    expect(screen.getByTestId("reg-licence-note").textContent).toContain("Held in the local store");
    const file = new File(["not a pdf"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("reg-licence-file"), { target: { files: [file] } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-licence-upload"));
    });
    const upload = deferredFetches().find((c) => c.url.endsWith("/documents") && c.init?.method === "POST")!;
    expect(upload.init?.body).toBeInstanceOf(FormData);
    await act(async () => {
      upload.resolve({ error: "validation_failed", message: "The request could not be accepted." }, 422);
    });
    expect(screen.getByTestId("reg-licence-error").textContent).toContain("The request could not be accepted.");
  });

  it("shows each gate and the fee, and keeps Submit off until every gate is met", async () => {
    nav.id = "reg-1";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration());
    await resolveAt(1, emptyDocs);
    await resolveAt(2, preview([false, true, true, true]));
    expect(screen.getByTestId("reg-gate-trade_licence_uploaded").getAttribute("data-met")).toBe("false");
    expect(screen.getByTestId("reg-gate-start_date_set").textContent).toContain("Start date set");
    expect(screen.getByTestId("reg-gate-brand_active").textContent).toContain("Brand still active");
    expect(screen.getByTestId("reg-gate-brand_name_free").textContent).toContain("Brand name still free");
    expect(screen.getByTestId("reg-fee-total").textContent).toContain("INR 5000.00");
    expect(screen.getByTestId("reg-fee-label").textContent).toContain("Local demo fee, not BEE-approved");
    expect(screen.getByTestId("reg-fee").textContent).toContain("REG:brand_registration");
    expect(screen.getByTestId("reg-fee").textContent).toContain("version 1");
    const before = deferredFetches().length;
    expect((screen.getByTestId("reg-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("reg-submit"));
    expect(deferredFetches().length).toBe(before);

    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration());
    await resolveAt(1, emptyDocs);
    await resolveAt(2, preview([true, true, true, true], false));
    expect((screen.getByTestId("reg-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits the fee that was shown, and shows fee_preview_conflict and document_required", async () => {
    nav.id = "reg-1";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration());
    await resolveAt(1, emptyDocs);
    await resolveAt(2, preview([true, true, true, true]));
    expect((screen.getByTestId("reg-submit") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-submit"));
    });
    const call = lastCall((c) => c.url.endsWith("/submit") && c.init?.method === "POST");
    expect(JSON.parse(String(call.init?.body))).toEqual({
      version: 3,
      expectedFee: { amountInr: "5000.00", feeRuleKey: "REG:brand_registration", feeRuleVersion: 1 },
    });
    await act(async () => {
      call.resolve({ error: "fee_preview_conflict", message: "The provisional fee changed since it was reviewed." }, 409);
    });
    expect(screen.getByTestId("reg-submit-error").textContent).toContain("The provisional fee changed since it was reviewed.");
    expect(screen.queryByTestId("reg-submit-reload")).toBeNull();

    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration());
    await resolveAt(1, emptyDocs);
    await resolveAt(2, preview([true, true, true, true]));
    await act(async () => {
      fireEvent.click(screen.getByTestId("reg-submit"));
    });
    await act(async () => {
      lastCall((c) => c.url.endsWith("/submit") && c.init?.method === "POST").resolve({ error: "document_required", message: "A trade licence must be uploaded before the registration request can be submitted." }, 422);
    });
    expect(screen.getByTestId("reg-submit-error").textContent).toContain("A trade licence must be uploaded before the registration request can be submitted.");
  });

  it("shows the fee-due note and the fee-confirmed note, and hides upload once the draft is filed", async () => {
    nav.id = "reg-1";
    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({ state: "fee_due", submissionFee: fee }));
    await resolveAt(1, licenceDocs);
    expect(screen.getByTestId("reg-fee-due").textContent).toContain("Fee due: INR 5000.00. Finance confirms it when it is received.");
    expect(screen.getByTestId("reg-fee-due").textContent).toContain("Local demo fee, not BEE-approved");
    expect(screen.getByTestId("reg-state").textContent).toContain("Fee due");
    expect(screen.queryByTestId("reg-licence-upload")).toBeNull();
    expect(screen.queryByTestId("reg-submit")).toBeNull();

    mount(<RegistrationRequest {...frame} />);
    await resolveAt(0, registration({ state: "programme_review", submissionFee: fee }));
    await resolveAt(1, licenceDocs);
    expect(screen.getByTestId("reg-fee-confirmed").textContent).toContain("Fee confirmed. Waiting for Programme review.");
    expect(screen.getByTestId("reg-state").textContent).toContain("Fee confirmed, with Programme review");
  });

  it("hides the registration menu from roles other than manufacturer and agency", () => {
    expect(runtimeNavFor([{ role: "manufacturer" }]).some((r) => r.href === "/app/registrations/requests")).toBe(true);
    expect(runtimeNavFor([{ role: "agency" }]).some((r) => r.href === "/app/registrations/requests")).toBe(true);
    for (const role of ["finance", "director", "programme", "reviewer", "iame", "admin", "secretary"]) {
      expect(runtimeNavFor([{ role }]).some((r) => r.href === "/app/registrations/requests")).toBe(false);
    }
  });
});
