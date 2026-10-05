import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalList, type AdminProposal } from "@/components/app/admin/ProposalPanels";
import { deferredFetches, installDeferredFetch } from "@/components/app/kit/__tests__/deferredFetch";

const ROUTE = "/app/administration/test";

type TestProposal = AdminProposal & { label: string };

const colleague: TestProposal = {
  id: "p1",
  state: "pending",
  proposedByYou: false,
  proposedBy: "Colleague",
  sourceReference: "Src",
  reason: "Because",
  label: "Rule A",
};

const own: TestProposal = {
  ...colleague,
  id: "p2",
  proposedByYou: true,
  proposedBy: "You",
};

const runDecide = vi.fn(async (payload: { id: string; decision: string; note?: string }, key: string) => {
  void key;
  const url = `/api/runtime/decide/${payload.id}`;
  const res = await fetch(url, { method: "POST", body: JSON.stringify(payload) });
  return res.json();
});

const decideSignature = (p: { id: string; decision: string; note?: string }) => [p.id, p.decision, p.note ?? ""];

function list(proposals: TestProposal[], onDone = vi.fn()) {
  cleanup();
  return render(
    <ProposalList
      title="Waiting for a second person"
      testId="feerules-pending"
      proposals={proposals}
      onDone={onDone}
      onReload={() => {}}
      decidable
      commandPrefix="feerule"
      signInReturnTo={ROUTE}
      runDecide={runDecide}
      decideSignature={decideSignature}
      approveLabel="Approve and start the rule"
      renderSummary={(p) => <strong>{p.label}</strong>}
      formatDecidedSuffix={() => ""}
    />,
  );
}

describe("ProposalPanels", () => {
  beforeEach(() => {
    installDeferredFetch();
    runDecide.mockClear();
  });

  it("offers approve and reject on a colleague's proposal, and only withdraw on your own", () => {
    list([colleague, own]);
    expect(screen.getByTestId("feerule-approve-run-p1")).toBeTruthy();
    expect(screen.getByTestId("feerule-reject-run-p1")).toBeTruthy();
    expect(screen.queryByTestId("feerule-withdraw-run-p1")).toBeNull();
    expect(screen.getByTestId("feerule-withdraw-run-p2")).toBeTruthy();
    expect(screen.queryByTestId("feerule-approve-run-p2")).toBeNull();
  });

  it("calls onDone when a decision succeeds", async () => {
    const onDone = vi.fn();
    list([colleague], onDone);
    await act(async () => {
      fireEvent.click(screen.getByTestId("feerule-approve-run-p1"));
      deferredFetches()[0].resolve({ ok: true, value: { ...colleague, state: "approved" }, replayed: false });
    });
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ state: "approved" }));
  });

  it("shows reload when the decide command fails with version_conflict", async () => {
    list([colleague]);
    await act(async () => {
      fireEvent.click(screen.getByTestId("feerule-approve-run-p1"));
      deferredFetches()[0].resolve({
        ok: false,
        failure: { kind: "conflict", code: "version_conflict", message: "The record has changed since it was loaded." },
      });
    });
    expect(screen.getByTestId("feerule-approve-error-p1")).toBeTruthy();
    expect(screen.getByTestId("feerule-approve-reload-p1")).toBeTruthy();
  });
});
