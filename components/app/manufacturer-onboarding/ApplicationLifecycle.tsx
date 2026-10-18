"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { ManufacturerApplication } from "@/lib/manufacturer-onboarding/types";
import {
  LABEL_AUTO_PAYMENT,
  LABEL_AUTO_RULES,
} from "@/lib/manufacturer-onboarding/statusLabels";
import { formatFeeInr } from "@/lib/manufacturer-onboarding/fees";
import { observationCountdown } from "@/lib/manufacturer-onboarding/observation";
import { useManufacturerOnboardingClient, useManufacturerOnboardingClock } from "./ManufacturerOnboardingProvider";
import {
  ErrorState,
  IstDate,
  LoadingState,
  NavLinks,
  OnboardingChrome,
  PhaseStatus,
  SimulatedPaymentNote,
  SyntheticBadge,
} from "./shared";

export function ApplicationLifecycle({ id }: { id: string }) {
  const client = useManufacturerOnboardingClient();
  const clock = useManufacturerOnboardingClock();
  const [app, setApp] = useState<ManufacturerApplication | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setApp(await client.getApplication(id));
    } catch {
      setError("Could not load this application.");
    }
  }, [client, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fixture client fetch on mount
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!app) return <LoadingState label="Loading application lifecycle…" />;

  const countdown = observationCountdown(app.observationEndsAt, clock ?? undefined);
  const navLinks = [
    { href: "/app/manufacturer/onboarding", label: "Wizard", testId: "nav-onboarding-wizard" },
    { href: `/app/manufacturer/application/${app.id}`, label: "Lifecycle", testId: "nav-onboarding-application" },
    { href: `/app/manufacturer/360/${app.id}`, label: "Manufacturer 360", testId: "nav-onboarding-360" },
  ];

  return (
    <OnboardingChrome icon="timeline" title={`Application ${app.reference}`}>
      <NavLinks links={navLinks} />
      <div className="flex flex-wrap items-center gap-2">
        <SyntheticBadge />
        <PhaseStatus phase={app.phase} />
      </div>

      <section className="bg-surface-card rounded-xl shadow-sm p-space-md space-y-space-md" data-testid="lifecycle-timeline">
        <h2 className="font-headline-sm text-headline-sm">Lifecycle timeline</h2>
        <ol className="space-y-3 border-l-2 border-outline-variant pl-4">
          {app.timeline.map((ev) => (
            <li key={ev.id} className="relative">
              <Icon name={ev.icon} size={18} className="absolute -left-[1.65rem] top-0.5 bg-surface-card" />
              <p className="font-label-md">{ev.title}</p>
              <p className="font-body-sm text-on-surface-variant">{ev.detail}</p>
              <p className="font-label-sm text-on-surface-variant"><IstDate iso={ev.at} /></p>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid md:grid-cols-2 gap-space-md">
        <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="payment-block">
          <h3 className="font-label-md font-semibold flex items-center gap-1"><Icon name="payments" size={18} /> Payment</h3>
          <SimulatedPaymentNote />
          <p className="font-body-sm" data-testid="lifecycle-fee">
            Fee: ₹ {formatFeeInr(app.payment.amountInr)} INR — {app.payment.feeLabel}
          </p>
          {app.payment.verifiedAt ? (
            <>
              <p className="font-body-sm"><strong>{LABEL_AUTO_PAYMENT}</strong></p>
              <p className="font-body-sm">Receipt: {app.payment.receiptNumber}</p>
              <p className="font-label-sm text-on-surface-variant"><IstDate iso={app.payment.verifiedAt} /></p>
            </>
          ) : (
            <p className="font-body-sm text-on-surface-variant">Payment pending until submit.</p>
          )}
        </section>

        <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="checks-block">
          <h3 className="font-label-md font-semibold flex items-center gap-1"><Icon name="rule" size={18} /> Automated checks</h3>
          {app.automatedChecks.length === 0 ? (
            <p className="font-body-sm text-on-surface-variant">Checks run after submit.</p>
          ) : (
            <>
              <p className="font-body-sm"><strong>{LABEL_AUTO_RULES}</strong></p>
              <ul className="space-y-1 font-body-sm">
                {app.automatedChecks.map((c) => (
                  <li key={c.id}>{c.label}: {c.outcome} — {c.detail}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {(app.registrationNumber || app.directorDecisionAt) && (
        <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="director-block">
          <h3 className="font-label-md font-semibold">Director decision & activation</h3>
          {app.directorDecisionAt && (
            <p className="font-body-sm">Decision recorded <IstDate iso={app.directorDecisionAt} /> — {app.directorDecisionNote}</p>
          )}
          {app.registrationNumber && (
            <p className="font-body-sm">Registration number: <strong data-testid="registration-number">{app.registrationNumber}</strong></p>
          )}
          {app.activatedAt && (
            <p className="font-body-sm">Activated <IstDate iso={app.activatedAt} /></p>
          )}
        </section>
      )}

      {app.phase === "automatic_checks_failed" && (
        <section className="bg-error-container/30 border border-error/30 rounded-xl p-space-md space-y-2" data-testid="checks-failed-panel">
          <h3 className="font-label-md font-semibold text-error">Automated checks failed</h3>
          <ul className="font-body-sm list-disc pl-5">
            {app.automatedChecks.filter((c) => c.outcome === "fail").map((c) => (
              <li key={c.id}>{c.label}: {c.detail}</li>
            ))}
          </ul>
          <p className="font-body-sm">Correct the application in the wizard and submit again.</p>
          <Link href="/app/manufacturer/onboarding" className="text-primary font-semibold" data-testid="checks-failed-wizard-link">
            Open company registration wizard
          </Link>
        </section>
      )}

      {countdown && app.phase === "active_observation" && app.observationEndsAt && (
        <section className="bg-surface-card rounded-xl p-space-md" data-testid="observation-countdown">
          <h3 className="font-label-md font-semibold">15-day observation</h3>
          {countdown.expired ? (
            <p className="font-body-sm">Observation window ended (see status label).</p>
          ) : (
            <p className="font-body-sm">
              <span data-testid="observation-days">{countdown.daysRemaining}</span> day(s) and{" "}
              <span data-testid="observation-hours">{countdown.hoursRemaining}</span> hour(s) remaining until{" "}
              <IstDate iso={app.observationEndsAt} />.
            </p>
          )}
        </section>
      )}

      {app.anomalies.length > 0 && (
        <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="anomaly-history">
          <h3 className="font-label-md font-semibold">Hold / anomaly / resolution</h3>
          <ul className="space-y-2 font-body-sm">
            {app.anomalies.map((a) => (
              <li key={a.id} className="border rounded-lg p-space-sm">
                <p>{a.summary}</p>
                <p className="text-on-surface-variant">Raised by {a.raisedByRole} — <IstDate iso={a.raisedAt} /></p>
                {a.holdAppliedAt && <p className="text-on-surface-variant">Immediate hold — <IstDate iso={a.holdAppliedAt} /></p>}
                {a.resolutionNote && <p>Resolution: {a.resolutionNote}</p>}
                {a.revokeReason && <p className="text-error">Revoke reason: {a.revokeReason}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(app.phase === "draft" || app.phase === "automatic_checks_failed") && (
        <p className="font-body-sm">
          <Link href="/app/manufacturer/onboarding" className="text-primary font-semibold">Continue in company registration wizard</Link>
        </p>
      )}
    </OnboardingChrome>
  );
}
