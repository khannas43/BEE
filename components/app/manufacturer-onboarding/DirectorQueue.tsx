"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { ManufacturerApplication, ManufacturerApplicationSummary } from "@/lib/manufacturer-onboarding/types";
import {
  LABEL_AUTO_PAYMENT,
  LABEL_AUTO_RULES,
} from "@/lib/manufacturer-onboarding/statusLabels";
import { canDirectorDecide } from "@/lib/manufacturer-onboarding/access";
import { useManufacturerOnboardingClient, useManufacturerOnboardingRoles } from "./ManufacturerOnboardingProvider";
import {
  EmptyState,
  ErrorState,
  IstDate,
  LoadingState,
  NavLinks,
  OnboardingChrome,
  PhaseStatus,
  SimulatedPaymentNote,
  SyntheticBadge,
} from "./shared";

export function DirectorQueue() {
  const client = useManufacturerOnboardingClient();
  const roles = useManufacturerOnboardingRoles();
  const mayDecide = canDirectorDecide(roles);
  const [queueLoad, setQueueLoad] = useState<"loading" | "ready">("loading");
  const [queue, setQueue] = useState<ManufacturerApplicationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ManufacturerApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionNote, setActionNote] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setError(null);
    setQueueLoad("loading");
    try {
      const items = await client.listDirectorQueue();
      setQueue(items);
      if (items[0] && !selectedId) setSelectedId(items[0].id);
      setQueueLoad("ready");
    } catch {
      setError("Could not load the Director queue.");
      setQueueLoad("ready");
    }
  }, [client, selectedId]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await client.getApplication(id));
    } catch {
      setDetail(null);
    }
  }, [client]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fixture client fetch on mount
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load detail when selection changes
      void loadDetail(selectedId);
    }
  }, [selectedId, loadDetail]);

  async function approve() {
    if (!selectedId || !detail) return;
    setBusy(true);
    setActionNote(null);
    try {
      const updated = await client.directorApprove({ id: selectedId, version: detail.version, note: "Approved in demonstration." });
      setDetail(updated);
      setActionNote("Application approved — manufacturer activated under observation.");
      await loadQueue();
    } catch {
      setActionNote("Approval failed — retry.");
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!selectedId || !rejectReason.trim() || !detail) return;
    setBusy(true);
    setActionNote(null);
    try {
      const updated = await client.directorReject({ id: selectedId, version: detail.version, reason: rejectReason.trim() });
      setDetail(updated);
      setRejectOpen(false);
      setRejectReason("");
      setActionNote("Application rejected.");
      await loadQueue();
    } catch {
      setActionNote("Rejection failed — provide a reason and retry.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void loadQueue()} />;

  const navLinks = [
    { href: "/app/manufacturer/director", label: "Director queue", testId: "nav-director-queue" },
    { href: "/app/manufacturer/monitoring", label: "Monitoring", testId: "nav-monitoring" },
  ];

  return (
    <OnboardingChrome icon="how_to_reg" title="Director — manufacturer registration decisions">
      <NavLinks links={navLinks} />

      {queueLoad === "loading" ? <LoadingState label="Loading queue…" /> : null}
      {queueLoad === "ready" && queue.length === 0 && !detail ? (
        <EmptyState title="No applications awaiting Director decision." testId="director-queue-empty" />
      ) : null}
      {(queue.length > 0 || detail) && (
        <div className="grid lg:grid-cols-3 gap-space-md">
          {queue.length > 0 ? (
            <ul className="space-y-2" data-testid="director-queue-list">
              {queue.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left rounded-xl border p-space-sm ${selectedId === item.id ? "border-primary bg-primary/5" : "border-outline-variant"}`}
                    data-testid={`queue-item-${item.reference}`}
                  >
                    <p className="font-label-md">{item.legalName}</p>
                    <p className="font-label-sm text-on-surface-variant">{item.reference}</p>
                    <PhaseStatus phase={item.phase} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-body-sm text-on-surface-variant lg:col-span-1">No applications awaiting Director decision.</p>
          )}

          {detail && (
            <div className={`space-y-space-md ${queue.length > 0 ? "lg:col-span-2" : "lg:col-span-3"}`}>
              <div className="flex flex-wrap gap-2 items-center">
                <SyntheticBadge />
                <PhaseStatus phase={detail.phase} />
              </div>
              <section className="bg-surface-card rounded-xl p-space-md space-y-2">
                <h2 className="font-headline-sm">{detail.draft.legalName}</h2>
                <PhaseStatus phase={detail.phase} />
                <SimulatedPaymentNote />
                <p className="font-body-sm"><strong>{LABEL_AUTO_PAYMENT}</strong> — receipt {detail.payment.receiptNumber}</p>
                <p className="font-body-sm"><strong>{LABEL_AUTO_RULES}</strong></p>
                <ul className="font-body-sm list-disc pl-5">
                  {detail.automatedChecks.map((c) => (
                    <li key={c.id}>{c.label}: {c.outcome} (<IstDate iso={c.completedAt} />)</li>
                  ))}
                </ul>
              </section>

              {mayDecide && detail.phase === "director_review" && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void approve()}
                    className="rounded-lg bg-primary text-on-primary px-4 py-2 font-semibold disabled:opacity-40"
                    data-testid="director-approve"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRejectOpen(true)}
                    className="rounded-lg border border-error text-error px-4 py-2 font-semibold"
                    data-testid="director-reject-open"
                  >
                    Reject
                  </button>
                </div>
              )}

              {actionNote && <p className="font-body-sm" role="status">{actionNote}</p>}

              <Link href={`/app/manufacturer/application/${detail.id}`} className="text-primary font-semibold inline-flex items-center gap-1" data-testid="director-view-lifecycle">
                <Icon name="open_in_new" size={16} /> Full lifecycle
              </Link>
            </div>
          )}
        </div>
      )}

      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal data-testid="director-reject-dialog">
          <div className="bg-surface-card rounded-xl shadow-lg max-w-md w-full p-space-md space-y-3">
            <h3 className="font-headline-sm">Confirm rejection</h3>
            <p className="font-body-sm text-on-surface-variant">A mandatory reason is required for rejection.</p>
            <textarea
              className="w-full rounded-lg border border-outline-variant p-2 font-body-md min-h-[80px]"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              data-testid="director-reject-reason"
              placeholder="Reason for rejection"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setRejectOpen(false)} className="rounded-lg border px-3 py-2" data-testid="director-reject-cancel">
                Cancel
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim() || busy}
                onClick={() => void reject()}
                className="rounded-lg bg-error text-on-error px-3 py-2 font-semibold disabled:opacity-40"
                data-testid="director-reject-confirm"
              >
                Reject application
              </button>
            </div>
          </div>
        </div>
      )}
    </OnboardingChrome>
  );
}
