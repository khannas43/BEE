import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegistrationFees } from "@/components/app/registrations/RegistrationFees";
import { deferredFetches, installDeferredFetch, type DeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ children, action }: { children?: ReactNode; action?: ReactNode }) => <div>{action}{children}</div>,
}));
vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => ({ status: "signed-in" as const, me: { displayName: "Finance", effectiveRoles: [{ role: "finance", scope: "all" }], organisations: [] } }),
  rolesText: () => "finance",
  orgsText: () => "",
  refreshIdentity: () => Promise.resolve({ status: "signed-out" as const }),
}));

const frame = { module: "model-label" as never, screen: "model-dashboard" as never };
const fee = { amountInr: "5000.00", taxRatePercent: "0.00", taxInr: "0.00", totalInr: "5000.00", currency: "INR", feeRuleKey: "REG:brand_registration", feeRuleVersion: 1, verificationStatus: "synthetic", localDemoFee: true, label: "Local demo fee" };
const reg = (id: string, reference: string, state: string) => ({ id, reference, kind: "brand", organisation: "NOVA", brandName: `Brand ${reference}`, state, version: 1, tradeLicenceUploaded: true, submissionFee: fee });
const list = (items: unknown[]) => ({ items, count: items.length, authority: "spring-database" });

async function resolveAt(index: number, body: unknown, status = 200) {
  await act(async () => {
    deferredFetches()[index].resolve(body, status);
  });
}

describe("registration fees (Finance)", () => {
  beforeEach(() => {
    cleanup();
    installDeferredFetch();
  });

  it("lists only the registrations waiting for their fee and confirms one with the version it saw", async () => {
    render(<RegistrationFees {...frame} />);
    await resolveAt(0, list([reg("11111111-1111-4111-8111-111111111111", "REG-2026-9001", "fee_due"), reg("22222222-2222-4222-8222-222222222222", "REG-2026-9002", "programme_review")]));
    expect(screen.getByTestId("regfee-row-REG-2026-9001")).toBeTruthy();
    expect(screen.queryByTestId("regfee-row-REG-2026-9002")).toBeNull();
    fireEvent.click(screen.getByTestId("regfee-open-REG-2026-9001"));
    expect(screen.getByTestId("regfee-fields").textContent).toContain("REG-2026-9001");
    expect((screen.getByTestId("regfee-amount") as HTMLInputElement).value).toBe("5000.00");
    fireEvent.click(screen.getByTestId("regfee-run"));
    expect(screen.getByTestId("regfee-input-error").textContent).toContain("Enter the receipt reference");
    fireEvent.change(screen.getByTestId("regfee-receipt"), { target: { value: "RCPT-77" } });
    fireEvent.change(screen.getByTestId("regfee-received-on"), { target: { value: "2026-10-17" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("regfee-run"));
    });
    const post = deferredFetches().find((c: DeferredFetch) => c.init?.method === "POST");
    expect(post?.url).toBe("/api/runtime/registrations/11111111-1111-4111-8111-111111111111/fee-confirmation");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ version: 1, receiptReference: "RCPT-77", receivedOn: "2026-10-17", amountInr: "5000.00" });
  });
});
