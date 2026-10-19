"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { ManufacturerApplication, ManufacturerApplicationSummary } from "@/lib/manufacturer-onboarding/types";
import { LABEL_AUTO_PAYMENT, LABEL_AUTO_RULES } from "@/lib/manufacturer-onboarding/statusLabels";
import { formatFeeInr } from "@/lib/manufacturer-onboarding/fees";
import { useManufacturerOnboardingClient } from "./ManufacturerOnboardingProvider";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OnboardingChrome,
  PhaseStatus,
} from "./shared";

function Panel({ title, icon, children, testId }: { title: string; icon: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-white shadow-sm overflow-hidden" data-testid={testId}>
      <div className="flex items-center gap-2 border-b border-border-subtle bg-surface-container-lowest/70 px-space-md py-2.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name={icon} size={16} />
        </span>
        <div role="heading" aria-level={3} className="font-label-md font-semibold text-on-surface">{title}</div>
      </div>
      <div className="p-space-md space-y-2">{children}</div>
    </div>
  );
}

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

  const passed = detail ? detail.automatedChecks.filter((c) => c.outcome === "pass").length : 0;

  return (
    <OnboardingChrome icon="verified_user" title="Manufacturer registrations awaiting decision">
      <div className="space-y-space-md">
        {queue.length > 0 ? (
          // One pending registration needs no picker; the list stays in the page, hidden, for assistive tools and tests.
          <div className={queue.length > 1 ? "flex flex-wrap gap-2" : "sr-only"} data-testid="director-pending-queue">
            {queue.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`director-item-${item.reference}`}
                onClick={() => setSelectedId(item.id)}
                className={`rounded-xl border px-3 py-2 text-left transition-colors ${selectedId === item.id ? "border-primary bg-primary/10" : "border-border-subtle bg-white hover:bg-surface-container-low"}`}
              >
                <span className="block font-mono text-sm font-semibold text-on-surface">{item.reference}</span>
                <span className="block text-xs text-on-surface-variant">{item.legalName}</span>
              </button>
            ))}
          </div>
        ) : null}
        {queue.length === 0 ? (
          <div className="rounded-2xl border border-border-subtle bg-white shadow-sm" data-testid="director-pending-queue">
            <EmptyState title="No manufacturer registrations are waiting for a decision." />
          </div>
        ) : null}

        <div className="space-y-space-md min-w-0" data-testid="director-decision-panel">
          {!selectedId || !detail || detail.id !== selectedId ? (
            <div className="rounded-2xl border border-border-subtle bg-white shadow-sm p-space-lg">
              <LoadingState label="Select a registration to review." />
            </div>
          ) : (
            <>
              <div className="rounded-2xl bg-gradient-to-r from-forest-dark to-primary text-on-primary shadow-md p-space-md lg:p-space-lg">
                <div className="flex flex-wrap items-start justify-between gap-space-md">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.14em] text-on-primary/70">Registration</p>
                    <p className="mt-1 font-mono text-2xl font-bold tracking-wide">{detail.reference}</p>
                    <p className="mt-2 text-base font-medium" data-testid="director-legal-name">{detail.draft.legalName}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-white/15 px-2.5 py-1">CIN {detail.draft.cin || "—"}</span>
                      <span className="rounded-full bg-white/15 px-2.5 py-1">GSTIN {detail.draft.gstin || "—"}</span>
                    </div>
                  </div>
                  <div className="rounded-xl bg-white/95 px-3 py-2 text-on-surface shadow-sm">
                    <PhaseStatus phase={detail.phase} />
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-space-md">
                <Panel title="Document status" icon="folder_open" testId="director-document-status">
                  <ul className="space-y-1.5">
                    {detail.draft.annexureDocuments.map((doc) => (
                      <li key={doc.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="block font-medium text-on-surface">{doc.kind}</span>
                          {doc.uploadedAt ? <span className="block truncate font-mono text-xs text-on-surface-variant">{doc.fileName}</span> : null}
                        </span>
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${doc.uploadedAt ? "text-success" : "text-error"}`}>
                          <Icon name={doc.uploadedAt ? "check_circle" : "cancel"} size={16} />
                          {doc.uploadedAt ? "Uploaded" : "Missing"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Panel>
                <div className="space-y-space-md">
                  <Panel title="Payment" icon="payments" testId="director-payment-status">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="whitespace-nowrap text-2xl font-bold text-on-surface">₹ {formatFeeInr(detail.payment.amountInr)}</span>
                      <span className={`inline-flex items-center gap-1 text-sm font-semibold ${detail.payment.verifiedAt ? "text-success" : "text-on-surface-variant"}`}>
                        <Icon name={detail.payment.verifiedAt ? "check_circle" : "schedule"} size={16} />
                        {detail.payment.verifiedAt ? LABEL_AUTO_PAYMENT : "Pending"}
                      </span>
                    </div>
                    {detail.payment.receiptNumber ? (
                      <p className="text-sm text-on-surface-variant">Receipt <span className="font-mono text-on-surface">{detail.payment.receiptNumber}</span></p>
                    ) : null}
                    <p className="text-xs text-on-surface-variant">Demonstration gateway: no live transaction is made.</p>
                  </Panel>
                  <Panel title={LABEL_AUTO_RULES} icon="rule" testId="director-automated-checks">
                    <p className="text-sm font-semibold text-success">{passed} of {detail.automatedChecks.length} checks passed</p>
                    <ul className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
                      {detail.automatedChecks.map((check) => (
                        <li key={check.id} className="flex items-start gap-1.5 text-[13px] leading-snug">
                          <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${check.outcome === "pass" ? "bg-success text-on-success" : "bg-error text-on-error"}`}>
                            <Icon name={check.outcome === "pass" ? "check" : "close"} size={12} />
                          </span>
                          <span>{check.label.charAt(0).toUpperCase() + check.label.slice(1)}</span>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </div>
              </div>

              {detail.phase === "director_review" ? (
                <Panel title="Your decision" icon="gavel">
                  <label className="block" htmlFor="director-decision-note">
                    <span className="font-label-md">Decision note / reason</span>
                    <textarea
                      id="director-decision-note"
                      data-testid="director-decision-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Optional for approval; at least 8 characters to return or reject"
                      className="mt-1 w-full rounded-xl border border-border-subtle bg-white p-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      rows={3}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" disabled={busy} data-testid="director-approve" onClick={() => void decide("approve")} className="inline-flex items-center gap-1.5 rounded-xl bg-primary text-on-primary px-4 py-2.5 font-semibold shadow-sm hover:opacity-95 disabled:opacity-50">
                      <Icon name="verified" size={18} /> Approve and activate
                    </button>
                    <button type="button" disabled={busy} data-testid="director-return" onClick={() => void decide("return")} className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant bg-white px-4 py-2.5 font-semibold text-on-surface hover:bg-surface-container-low disabled:opacity-50">
                      <Icon name="undo" size={18} /> Return to applicant
                    </button>
                    <button type="button" disabled={busy} data-testid="director-reject-open" onClick={() => void decide("reject")} className="inline-flex items-center gap-1.5 rounded-xl border border-error bg-white px-4 py-2.5 font-semibold text-error hover:bg-error-container/40 disabled:opacity-50">
                      <Icon name="block" size={18} /> Reject
                    </button>
                  </div>
                </Panel>
              ) : null}
              {statusMsg ? (
                <div className="rounded-xl border border-primary/30 bg-primary/5 px-space-md py-2.5 text-sm font-medium" data-testid="director-decision-status">{statusMsg}</div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </OnboardingChrome>
  );
}
