"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { ManufacturerApplication, ManufacturerApplicationSummary } from "@/lib/manufacturer-onboarding/types";
import { canRaiseAnomaly, canResolveOrRevoke } from "@/lib/manufacturer-onboarding/access";
import {
  LABEL_AUTO_PAYMENT,
  LABEL_HOLD,
} from "@/lib/manufacturer-onboarding/statusLabels";
import { observationCountdown } from "@/lib/manufacturer-onboarding/observation";
import { useManufacturerOnboardingClient, useManufacturerOnboardingClock, useManufacturerOnboardingRoles } from "./ManufacturerOnboardingProvider";
import {
  EmptyState,
  ErrorState,
  IstDate,
  LoadingState,
  OnboardingChrome,
  PhaseStatus,
} from "./shared";

export function MonitoringQueue() {
  const client = useManufacturerOnboardingClient();
  const roles = useManufacturerOnboardingRoles();
  const clock = useManufacturerOnboardingClock();
  const [queueLoad, setQueueLoad] = useState<"loading" | "ready">("loading");
  const [queue, setQueue] = useState<ManufacturerApplicationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ManufacturerApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [anomalySummary, setAnomalySummary] = useState("");
  const [directorNote, setDirectorNote] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setError(null);
    setQueueLoad("loading");
    try {
      // Only registrations that are active or on hold belong here; one still awaiting approval is not monitored yet.
      const items = (await client.listMonitoringQueue()).filter((i) => i.phase === "active_observation" || i.phase === "on_hold");
      setQueue(items);
      if (items[0] && !selectedId) setSelectedId(items[0].id);
      setQueueLoad("ready");
    } catch {
      setError("Could not load the monitoring queue.");
      setQueueLoad("ready");
    }
  }, [client, selectedId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fixture client fetch on mount
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (selectedId) {
      void client.getApplication(selectedId).then(setDetail).catch(() => setDetail(null));
    }
  }, [client, selectedId]);

  const isDirector = canResolveOrRevoke(roles);
  const canRaise = canRaiseAnomaly(roles);

  async function raiseAnomaly() {
    if (!selectedId || !anomalySummary.trim() || !canRaise || !detail) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const updated = await client.raiseAnomaly({
        applicationId: selectedId,
        version: detail.version,
        summary: anomalySummary.trim(),
      });
      setDetail(updated);
      setAnomalySummary("");
      setStatusMsg(`${LABEL_HOLD} — immediate hold applied.`);
      await loadQueue();
    } catch {
      setStatusMsg("Could not raise anomaly — application must be under active observation.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveHold() {
    if (!selectedId || !directorNote.trim() || !isDirector || !detail) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const updated = await client.directorResolve({ applicationId: selectedId, version: detail.version, note: directorNote.trim() });
      setDetail(updated);
      setDirectorNote("");
      setStatusMsg("Hold resolved — returned to active observation.");
      await loadQueue();
    } catch {
      setStatusMsg("Resolve failed.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeRegistration() {
    if (!selectedId || !directorNote.trim() || !isDirector || !detail) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const updated = await client.directorRevoke({ applicationId: selectedId, version: detail.version, reason: directorNote.trim() });
      setDetail(updated);
      setDirectorNote("");
      setStatusMsg("Registration revoked by Director.");
      await loadQueue();
    } catch {
      setStatusMsg("Revoke failed — reason required.");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void loadQueue()} />;

  const countdown = detail ? observationCountdown(detail.observationEndsAt, clock ?? undefined) : null;
  const holds = queue.filter((q) => q.phase === "on_hold").length;
  const ordered = [...queue].sort((x, y) => Number(y.phase === "on_hold") - Number(x.phase === "on_hold"));
  const ROLE_LABEL: Record<string, string> = { finance: "BEE Finance", programme: "BEE Programme", director: "BEE Director", officer: "BEE Officer" };
  const openAnomaly = detail ? [...detail.anomalies].reverse().find((x) => !x.resolvedAt && !x.revokedAt) : undefined;
  const passedChecks = detail ? detail.automatedChecks.filter((c) => c.outcome === "pass").length : 0;

  return (
    <OnboardingChrome icon="insights" title="Anomalies and holds">
      <p className="font-body-sm text-on-surface-variant">
        After activation a registration is watched for 15 days. Finance or Programme may flag an anomaly, which puts the registration on hold at once. Only the BEE Officer can then clear the hold or revoke the registration.
      </p>

      {queueLoad === "loading" ? (
        <LoadingState label="Loading cases…" />
      ) : queue.length === 0 ? (
        <EmptyState title="No manufacturers in observation or hold." />
      ) : (
        <div className="space-y-space-md">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3" data-testid="monitoring-tiles">
            <div className="rounded-2xl border border-[#f5c2c0] bg-[#fdecea] px-4 py-3"><div className="text-2xl font-bold text-[#93000a]">{holds}</div><div className="text-xs text-[#93000a]">On hold</div></div>
            <div className="rounded-2xl border border-border-subtle bg-white px-4 py-3"><div className="text-2xl font-bold text-on-surface">{queue.length - holds}</div><div className="text-xs text-on-surface-variant">Under observation</div></div>
            <div className="rounded-2xl border border-border-subtle bg-white px-4 py-3"><div className="text-2xl font-bold text-on-surface">{queue.length}</div><div className="text-xs text-on-surface-variant">Cases to watch</div></div>
          </div>

          <div className="grid items-start gap-space-md lg:grid-cols-[minmax(0,20rem)_1fr]">
            <ul className="space-y-2" data-testid="monitoring-queue-list">
              {ordered.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`w-full rounded-2xl border bg-white p-space-sm text-left shadow-sm transition-colors ${selectedId === item.id ? "border-primary ring-2 ring-primary/20" : "border-border-subtle hover:bg-surface-container-lowest"}`}
                    data-testid={`monitoring-item-${item.reference}`}
                    data-phase={item.phase}
                  >
                    <span className="block font-mono text-xs text-on-surface-variant">{item.reference}</span>
                    <span className="mt-0.5 block font-semibold text-on-surface">{item.legalName}</span>
                    <span className="mt-1.5 block"><PhaseStatus phase={item.phase} /></span>
                  </button>
                </li>
              ))}
            </ul>

            {detail ? (
              <div className="min-w-0 space-y-space-md">
                <div className="rounded-2xl bg-gradient-to-r from-forest-dark to-primary p-space-md text-on-primary shadow-md lg:p-space-lg">
                  <div className="flex flex-wrap items-start justify-between gap-space-md">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.14em] text-on-primary/70">Case</p>
                      <p className="mt-1 font-mono text-xl font-bold">{detail.reference}</p>
                      <p className="mt-1 text-base font-medium">{detail.draft.legalName}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-white/15 px-2.5 py-1">CIN {detail.draft.cin || "-"}</span>
                        <span className="rounded-full bg-white/15 px-2.5 py-1">GSTIN {detail.draft.gstin || "-"}</span>
                        {detail.registrationNumber ? <span className="rounded-full bg-white/15 px-2.5 py-1">Permittee {detail.registrationNumber}</span> : null}
                      </div>
                    </div>
                    <div className="rounded-xl bg-white/95 px-3 py-2 text-on-surface shadow-sm"><PhaseStatus phase={detail.phase} /></div>
                  </div>
                </div>

                {openAnomaly ? (
                  <div className="rounded-2xl border border-[#f5c2c0] bg-[#fdecea] p-space-md" data-testid="monitoring-hold-reason">
                    <div className="flex items-center gap-2 text-[#93000a]">
                      <Icon name="report" size={20} />
                      <span role="heading" aria-level={3} className="font-semibold">Anomaly found and reason for hold</span>
                    </div>
                    <p className="mt-2 text-sm text-on-surface">{openAnomaly.summary}</p>
                    <p className="mt-2 text-xs text-on-surface-variant">
                      Raised by {ROLE_LABEL[openAnomaly.raisedByRole] ?? openAnomaly.raisedByRole} on <IstDate iso={openAnomaly.raisedAt} />
                      {openAnomaly.holdAppliedAt ? <> · hold applied <IstDate iso={openAnomaly.holdAppliedAt} /></> : null}
                    </p>
                  </div>
                ) : null}

                <div className="grid gap-space-md md:grid-cols-2">
                  <div className="rounded-2xl border border-border-subtle bg-white p-space-md shadow-sm" data-testid="monitoring-summary">
                    <div role="heading" aria-level={3} className="mb-2 text-sm font-semibold text-on-surface">Payment and checks</div>
                    <p className="text-sm"><span className="font-semibold">{LABEL_AUTO_PAYMENT}</span><br /><span className="font-mono text-xs text-on-surface-variant">{detail.payment.receiptNumber ?? "-"}</span></p>
                    <p className="mt-2 text-sm text-success">{passedChecks} of {detail.automatedChecks.length} automated checks passed</p>
                  </div>
                  <div className="rounded-2xl border border-border-subtle bg-white p-space-md shadow-sm">
                    <div role="heading" aria-level={3} className="mb-2 text-sm font-semibold text-on-surface">Observation window</div>
                    <p className="text-sm">
                      <IstDate iso={detail.observationStartedAt} /> to <IstDate iso={detail.observationEndsAt} />
                    </p>
                    {countdown && !countdown.expired && detail.phase === "active_observation" ? (
                      <p className="mt-2 text-sm" data-testid="monitoring-observation-countdown">
                        {countdown.daysRemaining}d {countdown.hoursRemaining}h remaining
                      </p>
                    ) : null}
                  </div>
                </div>

                {canRaise && detail.phase === "active_observation" && (
                  <div className="space-y-2 rounded-2xl border border-border-subtle bg-white p-space-md shadow-sm" data-testid="raise-anomaly-form">
                    <div role="heading" aria-level={3} className="text-sm font-semibold text-on-surface">Raise an anomaly</div>
                    <textarea
                      className="min-h-[72px] w-full rounded-xl border border-border-subtle bg-white p-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={anomalySummary}
                      onChange={(e) => setAnomalySummary(e.target.value)}
                      placeholder="Describe what was found; the registration is held at once"
                      data-testid="anomaly-summary"
                    />
                    <button
                      type="button"
                      disabled={busy || !anomalySummary.trim()}
                      onClick={() => void raiseAnomaly()}
                      className="rounded-xl bg-solar-gold-dark px-4 py-2.5 font-semibold text-on-primary disabled:opacity-40"
                      data-testid="raise-anomaly-submit"
                    >
                      Raise anomaly and apply hold
                    </button>
                  </div>
                )}

                {isDirector && detail.phase === "on_hold" && (
                  <div className="space-y-2 rounded-2xl border border-border-subtle bg-white p-space-md shadow-sm" data-testid="director-hold-actions">
                    <div role="heading" aria-level={3} className="text-sm font-semibold text-on-surface">Your decision: clear the hold or revoke</div>
                    <textarea
                      className="min-h-[72px] w-full rounded-xl border border-border-subtle bg-white p-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      value={directorNote}
                      onChange={(e) => setDirectorNote(e.target.value)}
                      placeholder="Reason for your decision (required)"
                      data-testid="director-hold-note"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={busy || !directorNote.trim()} onClick={() => void resolveHold()} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 font-semibold text-on-primary disabled:opacity-40" data-testid="director-resolve">
                        <Icon name="check_circle" size={18} /> Clear hold, resume observation
                      </button>
                      <button type="button" disabled={busy || !directorNote.trim()} onClick={() => void revokeRegistration()} className="inline-flex items-center gap-1.5 rounded-xl border border-error bg-white px-4 py-2.5 font-semibold text-error disabled:opacity-40" data-testid="director-revoke">
                        <Icon name="block" size={18} /> Revoke registration
                      </button>
                    </div>
                  </div>
                )}

                {!isDirector && detail.phase === "on_hold" && (
                  <p className="text-sm text-on-surface-variant">On hold, awaiting the decision of the BEE Officer to clear or revoke.</p>
                )}

                {statusMsg && <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 px-space-md py-2.5 text-sm font-medium">{statusMsg}</div>}

                <Link href={`/app/demo/manufacturer-360?m=live-${detail.id}`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" data-testid="monitoring-360-link">
                  <Icon name="hub" size={18} /> Open Manufacturer 360 profile
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </OnboardingChrome>
  );
}
