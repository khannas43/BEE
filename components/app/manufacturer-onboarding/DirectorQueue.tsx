"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { ManufacturerApplication, ManufacturerApplicationSummary } from "@/lib/manufacturer-onboarding/types";
import { LABEL_AUTO_PAYMENT, LABEL_AUTO_RULES } from "@/lib/manufacturer-onboarding/statusLabels";
import { formatFeeInr } from "@/lib/manufacturer-onboarding/fees";
import { useManufacturerOnboardingClient } from "./ManufacturerOnboardingProvider";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NavLinks,
  OnboardingChrome,
  PhaseStatus,
  SimulatedPaymentNote,
} from "./shared";

export function DirectorQueue() {
  const client = useManufacturerOnboardingClient();
  const [queue, setQueue] = useState<ManufacturerApplicationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ManufacturerApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setError(null);
    try {
      const items = await client.listDirectorQueue();
      setQueue(items);
      setSelectedId((current) => current ?? items[0]?.id ?? null);
    } catch {
      setError("Could not load manufacturer registrations awaiting decision.");
    }
  }, [client]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fixture client fetch on mount
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    void client.getApplication(selectedId).then(setDetail).catch(() => setDetail(null));
  }, [client, selectedId]);

  async function decide(decision: "approve" | "return" | "reject") {
    if (!selectedId || !detail) return;
    if ((decision === "return" || decision === "reject") && note.trim().length < 8) {
      setStatusMsg("A reason of at least 8 characters is required to return or reject.");
      return;
    }
    setBusy(true);
    setStatusMsg(null);
    try {
      const updated = decision === "approve"
        ? await client.directorApprove({ id: selectedId, version: detail.version, note: note.trim() || undefined })
        : decision === "return"
          ? await client.directorReturn({ id: selectedId, version: detail.version, reason: note.trim() })
          : await client.directorReject({ id: selectedId, version: detail.version, reason: note.trim() });
      setDetail(updated);
      setNote("");
      setStatusMsg(decision === "approve"
        ? "Manufacturer activated. 15-day observation has started."
        : decision === "return"
          ? "Application returned to the applicant."
          : "Application rejected. The manufacturer remains inactive.");
      await loadQueue();
    } catch {
      setStatusMsg("The decision could not be recorded. Refresh and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void loadQueue()} />;

  const navLinks = [
    { href: "/app/manufacturer/director", label: "Registrations awaiting decision", testId: "nav-director-queue" },
    { href: "/app/manufacturer/monitoring", label: "Observation monitoring", testId: "nav-monitoring" },
  ];

  return (
    <OnboardingChrome icon="verified_user" title="Director — manufacturer registrations awaiting decision">
      <NavLinks links={navLinks} />
      <div className="grid lg:grid-cols-[minmax(0,18rem)_1fr] gap-space-md">
        <section className="bg-surface-card rounded-xl shadow-sm p-space-md space-y-2" data-testid="director-pending-queue">
          <h2 className="font-headline-sm">Pending registrations</h2>
          {queue.length === 0 ? (
            <EmptyState title="No manufacturer registrations are waiting for a Director decision." />
          ) : (
            <ul className="space-y-1">
              {queue.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    data-testid={`director-item-${item.reference}`}
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full text-left rounded-lg px-3 py-2 ${selectedId === item.id ? "bg-primary/10" : "hover:bg-surface-ground"}`}
                  >
                    <span className="font-label-md block">{item.reference}</span>
                    <span className="font-body-sm text-on-surface-variant">{item.legalName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-surface-card rounded-xl shadow-sm p-space-lg space-y-space-md" data-testid="director-decision-panel">
          {!selectedId || !detail || detail.id !== selectedId ? (
            <LoadingState label="Select a registration to review." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-headline-sm">{detail.reference}</h2>
                <PhaseStatus phase={detail.phase} />
              </div>
              <p className="font-body-md" data-testid="director-legal-name">{detail.draft.legalName}</p>
              <p className="font-body-sm text-on-surface-variant">CIN {detail.draft.cin || "—"} · GSTIN {detail.draft.gstin || "—"}</p>

              <div className="grid md:grid-cols-2 gap-space-md">
                <div data-testid="director-document-status">
                  <h3 className="font-label-md font-semibold">Document status</h3>
                  <ul className="mt-2 space-y-1 font-body-sm">
                    {detail.draft.annexureDocuments.map((doc) => (
                      <li key={doc.id}>{doc.kind}: {doc.uploadedAt ? "uploaded" : "missing"}</li>
                    ))}
                  </ul>
                </div>
                <div data-testid="director-payment-status">
                  <h3 className="font-label-md font-semibold">Payment</h3>
                  <SimulatedPaymentNote />
                  <p className="font-body-sm mt-1">₹ {formatFeeInr(detail.payment.amountInr)} — {detail.payment.verifiedAt ? LABEL_AUTO_PAYMENT : "pending"}</p>
                  {detail.payment.receiptNumber ? <p className="font-body-sm">Receipt {detail.payment.receiptNumber}</p> : null}
                </div>
              </div>

              <div data-testid="director-automated-checks">
                <h3 className="font-label-md font-semibold">{LABEL_AUTO_RULES}</h3>
                <ul className="mt-2 space-y-1 font-body-sm">
                  {detail.automatedChecks.map((check) => (
                    <li key={check.id}>{check.label}: {check.outcome}</li>
                  ))}
                </ul>
              </div>

              {detail.phase === "director_review" ? (
                <div className="space-y-3">
                  <label className="block" htmlFor="director-decision-note">
                    <span className="font-label-md">Decision note / reason</span>
                    <textarea
                      id="director-decision-note"
                      data-testid="director-decision-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-border-subtle p-3"
                      rows={3}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} data-testid="director-approve" onClick={() => void decide("approve")} className="rounded-lg bg-primary text-on-primary px-4 py-2 font-semibold disabled:opacity-50">
                      Approve and activate
                    </button>
                    <button type="button" disabled={busy} data-testid="director-return" onClick={() => void decide("return")} className="rounded-lg border border-border-subtle px-4 py-2 font-semibold disabled:opacity-50">
                      Return to applicant
                    </button>
                    <button type="button" disabled={busy} data-testid="director-reject-open" onClick={() => void decide("reject")} className="rounded-lg bg-error text-on-error px-4 py-2 font-semibold disabled:opacity-50">
                      Reject
                    </button>
                  </div>
                </div>
              ) : null}
              {statusMsg ? <p className="font-body-sm" data-testid="director-decision-status">{statusMsg}</p> : null}
              <Link href={`/app/manufacturer/360/${detail.id}`} className="inline-flex items-center gap-1 font-label-md text-primary" data-testid="director-open-360">
                Open Manufacturer 360 <Icon name="arrow_forward" size={16} />
              </Link>
            </>
          )}
        </section>
      </div>
    </OnboardingChrome>
  );
}
