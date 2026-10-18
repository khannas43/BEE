"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { ManufacturerApplication, ManufacturerApplicationSummary } from "@/lib/manufacturer-onboarding/types";
import { canRaiseAnomaly, canResolveOrRevoke } from "@/lib/manufacturer-onboarding/access";
import {
  LABEL_AUTO_PAYMENT,
  LABEL_AUTO_RULES,
  LABEL_HOLD,
} from "@/lib/manufacturer-onboarding/statusLabels";
import { observationCountdown } from "@/lib/manufacturer-onboarding/observation";
import { useManufacturerOnboardingClient, useManufacturerOnboardingClock, useManufacturerOnboardingRoles } from "./ManufacturerOnboardingProvider";
import {
  EmptyState,
  ErrorState,
  IstDate,
  LoadingState,
  NavLinks,
  OnboardingChrome,
  PhaseStatus,
  SyntheticBadge,
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
      const items = await client.listMonitoringQueue();
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

  const navLinks = [
    { href: "/app/manufacturer/monitoring", label: "Monitoring", testId: "nav-monitoring" },
    { href: "/app/manufacturer/director", label: "Director oversight", testId: "nav-director-queue" },
  ];

  const countdown = detail ? observationCountdown(detail.observationEndsAt, clock ?? undefined) : null;

  return (
    <OnboardingChrome icon="insights" title="Post-approval monitoring (information & anomalies)">
      <NavLinks links={navLinks} />
      <p className="font-body-sm text-on-surface-variant">
        Activation is automatic after successful payment and checks. Finance and Programme may flag anomalies; an anomaly applies an immediate hold, and only the Director may clear or revoke it.
      </p>

      {queueLoad === "loading" ? (
        <LoadingState label="Loading monitoring queue…" />
      ) : queue.length === 0 ? (
        <EmptyState title="No manufacturers in observation or hold." />
      ) : (
        <div className="grid lg:grid-cols-3 gap-space-md">
          <ul className="space-y-2" data-testid="monitoring-queue-list">
            {queue.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`w-full text-left rounded-xl border p-space-sm ${selectedId === item.id ? "border-primary bg-primary/5" : ""}`}
                  data-testid={`monitoring-item-${item.reference}`}
                  data-phase={item.phase}
                >
                  <p className="font-label-md">{item.legalName}</p>
                  <PhaseStatus phase={item.phase} />
                </button>
              </li>
            ))}
          </ul>

          {detail && (
            <div className="lg:col-span-2 space-y-space-md">
              <SyntheticBadge />
              <PhaseStatus phase={detail.phase} />
              {countdown && !countdown.expired && detail.phase === "active_observation" && (
                <p className="font-body-sm" data-testid="monitoring-observation-countdown">
                  Observation deadline: {countdown.daysRemaining}d {countdown.hoursRemaining}h remaining (<IstDate iso={detail.observationEndsAt} />)
                </p>
              )}
              <section className="bg-surface-card rounded-xl p-space-md font-body-sm space-y-1" data-testid="monitoring-summary">
                <p><strong>{LABEL_AUTO_PAYMENT}</strong> — {detail.payment.receiptNumber ?? "—"}</p>
                <p><strong>{LABEL_AUTO_RULES}</strong> — {detail.automatedChecks.length} check(s)</p>
              </section>

              {canRaise && detail.phase === "active_observation" && (
                <section className="bg-surface-container-low rounded-xl p-space-md space-y-2" data-testid="raise-anomaly-form">
                  <h3 className="font-label-md font-semibold">Raise anomaly (information)</h3>
                  <textarea
                    className="w-full rounded-lg border p-2 min-h-[72px]"
                    value={anomalySummary}
                    onChange={(e) => setAnomalySummary(e.target.value)}
                    placeholder="Describe the anomaly for Director review"
                    data-testid="anomaly-summary"
                  />
                  <button
                    type="button"
                    disabled={busy || !anomalySummary.trim()}
                    onClick={() => void raiseAnomaly()}
                    className="rounded-lg bg-solar-gold-dark text-on-primary px-3 py-2 font-semibold disabled:opacity-40"
                    data-testid="raise-anomaly-submit"
                  >
                    Raise anomaly & apply hold
                  </button>
                </section>
              )}

              {isDirector && detail.phase === "on_hold" && (
                <section className="space-y-2" data-testid="director-hold-actions">
                  <h3 className="font-label-md font-semibold">Director — resolve or revoke</h3>
                  <textarea
                    className="w-full rounded-lg border p-2 min-h-[72px]"
                    value={directorNote}
                    onChange={(e) => setDirectorNote(e.target.value)}
                    data-testid="director-hold-note"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy || !directorNote.trim()} onClick={() => void resolveHold()} className="rounded-lg bg-primary text-on-primary px-3 py-2 font-semibold disabled:opacity-40" data-testid="director-resolve">
                      Resolve to active
                    </button>
                    <button type="button" disabled={busy || !directorNote.trim()} onClick={() => void revokeRegistration()} className="rounded-lg border border-error text-error px-3 py-2 font-semibold disabled:opacity-40" data-testid="director-revoke">
                      Revoke registration
                    </button>
                  </div>
                </section>
              )}

              {!isDirector && detail.phase === "on_hold" && (
                <p className="font-body-sm text-on-surface-variant">On hold — awaiting Director resolve or revoke.</p>
              )}

              {statusMsg && <p role="status" className="font-body-sm">{statusMsg}</p>}

              <Link href={`/app/manufacturer/360/${detail.id}`} className="inline-flex items-center gap-1 text-primary font-semibold" data-testid="monitoring-360-link">
                <Icon name="account_tree" size={18} /> Manufacturer 360
              </Link>
            </div>
          )}
        </div>
      )}
    </OnboardingChrome>
  );
}
