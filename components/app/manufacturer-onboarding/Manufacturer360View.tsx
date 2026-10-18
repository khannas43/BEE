"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { ManufacturerApplication } from "@/lib/manufacturer-onboarding/types";
import { formatFeeInr } from "@/lib/manufacturer-onboarding/fees";
import {
  LABEL_AUTO_PAYMENT,
  LABEL_AUTO_RULES,
} from "@/lib/manufacturer-onboarding/statusLabels";
import { observationCountdown } from "@/lib/manufacturer-onboarding/observation";
import { useManufacturerOnboardingClient, useManufacturerOnboardingClock } from "./ManufacturerOnboardingProvider";
import {
  ErrorState,
  IstDate,
  LoadingState,
  NavLinks,
  OnboardingChrome,
  PhaseStatus,
  SyntheticBadge,
} from "./shared";

export function Manufacturer360View({ id }: { id: string }) {
  const client = useManufacturerOnboardingClient();
  const clock = useManufacturerOnboardingClock();
  const [app, setApp] = useState<ManufacturerApplication | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setApp(await client.getApplication(id));
    } catch {
      setError("Could not load Manufacturer 360.");
    }
  }, [client, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fixture client fetch on mount
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!app) return <LoadingState label="Loading Manufacturer 360…" />;

  const countdown = observationCountdown(app.observationEndsAt, clock ?? undefined);
  const navLinks = [
    { href: `/app/manufacturer/360/${app.id}`, label: "360 view", testId: "nav-360" },
    { href: `/app/manufacturer/application/${app.id}`, label: "Lifecycle", testId: "nav-lifecycle-from-360" },
  ];

  return (
    <OnboardingChrome icon="account_tree" title="Manufacturer 360">
      <NavLinks links={navLinks} />
      <div className="flex flex-wrap gap-2 items-center">
        <SyntheticBadge />
        <PhaseStatus phase={app.phase} />
      </div>

      <div className="grid md:grid-cols-2 gap-space-md">
        <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="360-identity">
          <h2 className="font-label-md font-semibold">Company identity</h2>
          <p className="font-body-md font-semibold">{app.draft.legalName}</p>
          <p className="font-body-sm">CIN {app.draft.cin} · GSTIN {app.draft.gstin}</p>
          <p className="font-body-sm">{app.draft.registeredAddress.line1}, {app.draft.registeredAddress.city}</p>
          {app.registrationNumber && <p className="font-body-sm">Registration: <strong>{app.registrationNumber}</strong></p>}
        </section>

        <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="360-facilities">
          <h2 className="font-label-md font-semibold">Facilities</h2>
          <ul className="font-body-sm space-y-1">
            {app.draft.facilities.map((f) => (
              <li key={f.id}>{f.name} — {f.city}, {f.state}</li>
            ))}
          </ul>
        </section>

        <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="360-payment">
          <h2 className="font-label-md font-semibold">Payment</h2>
          <p className="font-body-sm">{LABEL_AUTO_PAYMENT}</p>
          <p className="font-body-sm" data-testid="360-fee">
            ₹ {formatFeeInr(app.payment.amountInr)} — {app.payment.receiptNumber ?? "Pending"}
          </p>
        </section>

        <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="360-checks">
          <h2 className="font-label-md font-semibold">Automated checks</h2>
          <p className="font-body-sm">{LABEL_AUTO_RULES}</p>
          <ul className="font-body-sm list-disc pl-4">
            {app.automatedChecks.map((c) => (
              <li key={c.id}>{c.label}: {c.outcome}</li>
            ))}
          </ul>
        </section>

        <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="360-director">
          <h2 className="font-label-md font-semibold">Director approval</h2>
          {app.directorDecisionAt ? (
            <p className="font-body-sm">Approved <IstDate iso={app.directorDecisionAt} /> — {app.directorDecisionNote}</p>
          ) : (
            <p className="font-body-sm text-on-surface-variant">Not yet approved.</p>
          )}
        </section>

        <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="360-observation">
          <h2 className="font-label-md font-semibold">Observation</h2>
          {app.observationEndsAt ? (
            countdown && !countdown.expired ? (
              <p className="font-body-sm">{countdown.daysRemaining} days remaining until <IstDate iso={app.observationEndsAt} /></p>
            ) : (
              <p className="font-body-sm">Window ended <IstDate iso={app.observationEndsAt} /></p>
            )
          ) : (
            <p className="font-body-sm text-on-surface-variant">Not in observation.</p>
          )}
        </section>
      </div>

      <section className="bg-surface-card rounded-xl p-space-md space-y-2" data-testid="360-anomaly-history">
        <h2 className="font-label-md font-semibold">Anomaly / hold history</h2>
        {app.anomalies.length === 0 ? (
          <p className="font-body-sm text-on-surface-variant">No anomalies recorded.</p>
        ) : (
          <ul className="font-body-sm space-y-2">
            {app.anomalies.map((a) => (
              <li key={a.id} className="border rounded-lg p-2">{a.summary}</li>
            ))}
          </ul>
        )}
      </section>

      <p className="font-body-sm flex items-center gap-1" data-testid="360-operational-status">
        <Icon name="info" size={16} /> Current operational status: <PhaseStatus phase={app.phase} />
      </p>

      <Link href="/app/manufacturer/monitoring" className="text-primary font-semibold">Monitoring queue</Link>
    </OnboardingChrome>
  );
}
