import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StageWorkScreen } from "@/components/app/lifecycle/StageWorkScreen";
import { stageDetailRows } from "@/components/app/lifecycle/stageDetailRows";
import type { ModelApplication } from "@/lib/client/runtimeModelApplications";
import { deferredFetches, installDeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";

vi.mock("@/components/app/ScreenScaffold", () => ({
  ScreenChrome: ({ children }: { children: ReactNode }) => <div data-testid="screen-chrome">{children}</div>,
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/app/lifecycle/ApplicationDocuments", () => ({
  ApplicationDocuments: () => <div data-testid="mock-documents" />,
}));

vi.mock("@/components/app/lifecycle/ApplicationHistory", () => ({
  ApplicationHistory: () => <div data-testid="mock-history" />,
}));

vi.mock("@/components/app/lifecycle/ReturnToApplicant", () => ({
  ReturnToApplicant: () => <div data-testid="test-return" />,
  ReturnedNote: () => null,
}));

vi.mock("@/components/app/lifecycle/RejectApplication", () => ({
  RejectApplication: () => <div data-testid="test-reject" />,
  RejectedNote: () => null,
}));

const ROUTE = "/app/test-stage";
const navState = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navState.params,
}));

vi.mock("@/components/app/SessionBadge", () => ({
  useSpringIdentity: () => ({
    status: "signed-in" as const,
    me: { displayName: "Officer One", roles: [{ code: "iame", label: "IAME" }], organisations: [] },
  }),
  rolesText: () => "IAME",
  orgsText: () => "",
}));

const sampleApp: ModelApplication = {
  id: "app-1",
  reference: "REF-001",
  organisation: "Org",
  brandName: "Brand",
  category: "AC",
  modelNumber: "M1",
  state: "iame_scrutiny",
  version: 1,
  readBasis: ["assigned"],
};

const listBody = { items: [sampleApp], count: 1, authority: "spring-database" };

function harness(overrides?: Partial<ComponentProps<typeof StageWorkScreen>>) {
  cleanup();
  return render(
    <StageWorkScreen
      module={"model-label" as never}
      screen={"iame-scrutiny" as never}
      route={ROUTE}
      subtitle="Test stage"
      screenTestId="test-scrutiny"
      testIdPrefix="test"
      copy={{
        listTitle: "Queue",
        loading: "Loading…",
        loadingDetail: "Loading detail…",
        empty: "Empty queue",
        provisional: "Provisional rules",
      }}
      detailFieldsTestId="test-detail-fields"
      historyTestIdPrefix="test-history"
      detailRows={(a) => stageDetailRows(a)}
      renderPrimary={() => <p data-testid="test-primary">Primary panel</p>}
      {...overrides}
    />,
  );
}

describe("StageWorkScreen", () => {
  beforeEach(() => {
    installDeferredFetch();
    navState.params = new URLSearchParams();
  });

  it("shows queue loading then the list", async () => {
    harness();
    expect(screen.getByTestId("test-queue-loading")).toBeTruthy();
    await act(async () => {
      deferredFetches().find((c) => c.url.includes("model-applications") && !c.url.includes("app-1"))!.resolve(listBody);
    });
    expect(screen.getByTestId("test-ref-REF-001")).toBeTruthy();
    expect(screen.queryByTestId("test-queue-loading")).toBeNull();
  });

  it("shows empty queue copy when the list has no items", async () => {
    harness();
    await act(async () => {
      deferredFetches()[0].resolve({ items: [], count: 0, authority: "spring-database" });
    });
    expect(screen.getByTestId("test-queue-empty").textContent).toBe("Empty queue");
  });

  it("loads detail when an id is selected", async () => {
    navState.params = new URLSearchParams({ id: "app-1" });
    harness();
    await act(async () => {
      for (const call of deferredFetches()) {
        if (call.url.endsWith("/model-applications")) call.resolve(listBody);
        else if (call.url.includes("/app-1")) call.resolve(sampleApp);
      }
    });
    expect(screen.getByTestId("test-detail-fields")).toBeTruthy();
    expect(screen.getByTestId("test-primary")).toBeTruthy();
  });

  it("shows primary success instead of the detail form", async () => {
    navState.params = new URLSearchParams({ id: "app-1" });
    harness({
      renderPrimaryDone: () => <div data-testid="test-done">Done</div>,
    });
    await act(async () => {
      for (const call of deferredFetches()) {
        if (call.url.endsWith("/model-applications")) call.resolve(listBody);
        else if (call.url.includes("/app-1")) call.resolve(sampleApp);
      }
    });
    expect(screen.getByTestId("test-done")).toBeTruthy();
    expect(screen.queryByTestId("test-primary")).toBeNull();
  });

  it("omits the return panel when showReturnPanel is false", async () => {
    navState.params = new URLSearchParams({ id: "app-1" });
    harness({ showReturnPanel: false });
    await act(async () => {
      for (const call of deferredFetches()) {
        if (call.url.endsWith("/model-applications")) call.resolve(listBody);
        else if (call.url.includes("/app-1")) call.resolve(sampleApp);
      }
    });
    expect(screen.queryByTestId("test-return")).toBeNull();
    expect(screen.getByTestId("test-reject")).toBeTruthy();
  });
});
