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
  OnboardingChrome,
  PhaseStatus,
} from "./shared";

type StepState = "done" | "current" | "pending" | "failed";

function lifecycleSteps(app: ManufacturerApplication): { key: string; label: string; detail: string; state: StepState }[] {
  const submitted = app.phase !== "draft";
  const paid = !!app.payment.verifiedAt;
  const checked = app.automatedChecks.length > 0;
  const checksFailed = app.phase === "automatic_checks_failed" || app.automatedChecks.some((c) => c.outcome === "fail");
  const decided = !!app.directorDecisionAt || ["active_observation", "active", "on_hold", "revoked", "rejected"].includes(app.phase);
  const live = ["active_observation", "active", "on_hold", "revoked"].includes(app.phase);
  const rejected = app.phase === "rejected";
  const firstOpen = (states: StepState[]) => states.findIndex((x) => x === "pending");
  const states: StepState[] = [
    submitted ? "done" : "pending",
    paid ? "done" : "pending",
    checksFailed ? "failed" : checked ? "done" : "pending",
    rejected ? "failed" : decided ? "done" : "pending",
    live ? "done" : "pending",
  ];
  const next = firstOpen(states);
  if (next >= 0 && !checksFailed) states[next] = "current";
  return [
    { key: "submitted", label: "Submitted", detail: "Application received", state: states[0] },
    { key: "payment", label: "Payment verified", detail: "Fee confirmed automatically", state: states[1] },
    { key: "checks", label: "Automated checks", detail: "Documents and eligibility", state: states[2] },
    { key: "approval", label: "BEE Officer approval", detail: rejected ? "Registration rejected" : decided ? "Decision recorded" : "Decision pending", state: states[3] },
    { key: "active", label: "Active, under observation", detail: "15-day monitoring window", state: states[4] },
  ];
}

const STEP_STYLE: Record<StepState, { dot: string; text: string; icon: string }> = {
  done: { dot: "bg-success text-on-success", text: "text-on-surface", icon: "check" },
  current: { dot: "bg-primary text-on-primary ring-4 ring-primary/20", text: "text-primary font-semibold", icon: "more_horiz" },
  pending: { dot: "bg-surface-container-high text-on-surface-variant", text: "text-on-surface-variant", icon: "" },
  failed: { dot: "bg-error text-on-error", text: "text-error font-semibold", icon: "priority_high" },
};

function Card({ title, icon, children, testId }: { title: string; icon: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-white shadow-sm overflow-hidden" data-testid={testId}>
      <header className="flex items-center gap-2 border-b border-border-subtle bg-surface-container-lowest/70 px-space-md py-2.5">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon name={icon} size={16} />
        </span>
        <div role="heading" aria-level={3} className="font-label-md font-semibold text-on-surface">{title}</div>
      </header>
      <div className="p-space-md space-y-2">{children}</div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-right font-medium text-on-surface">{children}</span>
    </div>
  );
}

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
  const steps = lifecycleSteps(app);
  const firstEvent = app.timeline.find((e) => e.title === "Registration submitted") ?? app.timeline[app.timeline.length - 1] ?? null;
  const passed = app.automatedChecks.filter((c) => c.outcome === "pass").length;
  const failedChecks = app.automatedChecks.filter((c) => c.outcome === "fail");

  return (
    <OnboardingChrome icon="timeline" title="Company registration">
      <div className="rounded-2xl bg-gradient-to-r from-forest-dark to-primary text-on-primary shadow-md p-space-md lg:p-space-lg" data-testid="lifecycle-hero">
        <div className="flex flex-wrap items-start justify-between gap-space-md">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.14em] text-on-primary/70">Application reference</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-wide" data-testid="lifecycle-reference">{app.reference}</p>
            <p className="mt-2 text-base font-medium text-on-primary/95">{app.draft.legalName || "Company name pending"}</p>
            {firstEvent && (
              <p className="mt-1 text-xs text-on-primary/70">Submitted <IstDate iso={firstEvent.at} /></p>
            )}
          </div>
          <div className="rounded-xl bg-white/95 px-3 py-2 text-on-surface shadow-sm">
            <PhaseStatus phase={app.phase} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border-subtle bg-white shadow-sm px-space-md py-space-md" aria-label="Progress" data-testid="lifecycle-progress">
        <ol className="grid grid-cols-5 gap-2">
          {steps.map((st, i) => {
            const style = STEP_STYLE[st.state];
            return (
              <li key={st.key} className="relative flex flex-col items-center text-center">
                {i > 0 && (
                  <span
                    className={`absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2 ${steps[i - 1].state === "done" ? "bg-success" : "bg-outline-variant"}`}
                    aria-hidden="true"
                  />
                )}
                <span className={`relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${style.dot}`}>
                  {style.icon ? <Icon name={style.icon} size={16} /> : i + 1}
                </span>
                <span className={`mt-2 text-xs leading-tight ${style.text}`}>{st.label}</span>
                <span className="mt-0.5 hidden text-[11px] leading-tight text-on-surface-variant sm:block">{st.detail}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {app.phase === "director_review" && (
        <div className="flex gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-space-md" data-testid="registration-submitted-confirmation">
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
            <Icon name="mark_email_read" size={18} />
          </span>
          <div>
            <div role="heading" aria-level={2} className="font-headline-sm text-headline-sm">Thank you, your manufacturer registration has been submitted</div>
            <p className="mt-1 font-body-md text-on-surface-variant">
              Your application reference is <strong className="text-on-surface">{app.reference}</strong>. The registration acknowledgement has been sent to the email address on your applicant account.
            </p>
          </div>
        </div>
      )}

      {app.phase === "automatic_checks_failed" && (
        <div className="rounded-2xl border border-error/30 bg-error-container/30 p-space-md space-y-2" data-testid="checks-failed-panel">
          <div role="heading" aria-level={3} className="font-label-md font-semibold text-error flex items-center gap-1.5"><Icon name="error" size={18} /> Automated checks need your attention</div>
          <ul className="font-body-sm list-disc pl-5">
            {failedChecks.map((c) => (
              <li key={c.id}>{c.label}: {c.detail}</li>
            ))}
          </ul>
          <p className="font-body-sm">Correct the application in the wizard and submit again.</p>
          <Link href="/app/manufacturer/onboarding" className="inline-flex items-center gap-1 text-primary font-semibold" data-testid="checks-failed-wizard-link">
            Open company registration wizard <Icon name="arrow_forward" size={16} />
          </Link>
        </div>
      )}

      <div className="grid gap-space-md lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-2xl border border-border-subtle bg-white shadow-sm overflow-hidden" data-testid="lifecycle-timeline">
          <header className="flex items-center gap-2 border-b border-border-subtle bg-surface-container-lowest/70 px-space-md py-2.5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon name="timeline" size={16} />
            </span>
            <div role="heading" aria-level={2} className="font-label-md font-semibold text-on-surface">Lifecycle timeline</div>
          </header>
          <ol className="p-space-md">
            {app.timeline.map((ev, i) => (
              <li key={ev.id} className="relative flex gap-3 pb-5 last:pb-0">
                {i < app.timeline.length - 1 && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-outline-variant" aria-hidden="true" />}
                <span className="relative z-10 mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-4 ring-surface-card" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
                <div className="min-w-0">
                  <p className="font-label-md font-semibold text-on-surface">{ev.title}</p>
                  {ev.detail && <p className="font-body-sm text-on-surface-variant">{ev.detail}</p>}
                  <p className="mt-0.5 text-xs text-on-surface-variant"><IstDate iso={ev.at} /></p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="lg:col-span-2 space-y-space-md">
          <Card title="Payment" icon="payments" testId="payment-block">
            <p className="font-body-sm" data-testid="lifecycle-fee">
              Fee: ₹ {formatFeeInr(app.payment.amountInr)} INR — {app.payment.feeLabel}
            </p>
            {app.payment.verifiedAt ? (
              <>
                <Fact label="Status"><span className="inline-flex items-center gap-1 text-success"><Icon name="check_circle" size={16} /> {LABEL_AUTO_PAYMENT}</span></Fact>
                <Fact label="Receipt"><span className="font-mono">{app.payment.receiptNumber}</span></Fact>
                <Fact label="Verified"><IstDate iso={app.payment.verifiedAt} /></Fact>
              </>
            ) : (
              <p className="font-body-sm text-on-surface-variant">Payment pending until submit.</p>
            )}
            <p className="pt-1 text-xs text-on-surface-variant">Demonstration gateway: no live transaction is made.</p>
          </Card>

          <Card title="Automated checks" icon="rule" testId="checks-block">
            {app.automatedChecks.length === 0 ? (
              <p className="font-body-sm text-on-surface-variant">Checks run after submit.</p>
            ) : (
              <>
                <p className="font-body-sm font-semibold flex items-center justify-between gap-2">
                  <span>{LABEL_AUTO_RULES}</span>
                  <span className="rounded-full bg-success-container px-2 py-0.5 text-xs font-semibold text-on-success-container">{passed} of {app.automatedChecks.length} passed</span>
                </p>
                <ul className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2">
                  {app.automatedChecks.map((c) => (
                    <li key={c.id} className="flex items-start gap-1.5 text-[13px] leading-snug">
                      <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${c.outcome === "pass" ? "bg-success text-on-success" : "bg-error text-on-error"}`}>
                        <Icon name={c.outcome === "pass" ? "check" : "close"} size={12} />
                      </span>
                      <span>
                        {c.label.charAt(0).toUpperCase() + c.label.slice(1)}
                        {c.outcome !== "pass" && c.detail ? <span className="text-on-surface-variant">: {c.detail}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          {(app.registrationNumber || app.directorDecisionAt) && (
            <Card title="Approval and activation" icon="verified" testId="director-block">
              {app.directorDecisionAt && (
                <Fact label="Decision recorded"><IstDate iso={app.directorDecisionAt} /></Fact>
              )}
              {app.directorDecisionNote && <p className="font-body-sm text-on-surface-variant">{app.directorDecisionNote}</p>}
              {app.registrationNumber && (
                <Fact label="Registration number"><strong data-testid="registration-number" className="font-mono">{app.registrationNumber}</strong></Fact>
              )}
              {app.activatedAt && <Fact label="Activated"><IstDate iso={app.activatedAt} /></Fact>}
            </Card>
          )}

          {countdown && app.phase === "active_observation" && app.observationEndsAt && (
            <Card title="15-day observation" icon="hourglass_top" testId="observation-countdown">
              {countdown.expired ? (
                <p className="font-body-sm">Observation window ended (see status label).</p>
              ) : (
                <p className="font-body-sm">
                  <span className="text-2xl font-bold text-primary" data-testid="observation-days">{countdown.daysRemaining}</span> day(s) and{" "}
                  <span className="font-semibold" data-testid="observation-hours">{countdown.hoursRemaining}</span> hour(s) remaining until{" "}
                  <IstDate iso={app.observationEndsAt} />.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>

      {app.anomalies.length > 0 && (
        <Card title="Hold, anomaly and resolution" icon="report" testId="anomaly-history">
          <ul className="space-y-2 font-body-sm">
            {app.anomalies.map((a) => (
              <li key={a.id} className="rounded-xl border border-border-subtle p-space-sm">
                <p className="font-medium">{a.summary}</p>
                <p className="text-on-surface-variant">Raised by {a.raisedByRole} — <IstDate iso={a.raisedAt} /></p>
                {a.holdAppliedAt && <p className="text-on-surface-variant">Immediate hold — <IstDate iso={a.holdAppliedAt} /></p>}
                {a.resolutionNote && <p>Resolution: {a.resolutionNote}</p>}
                {a.revokeReason && <p className="text-error">Revoke reason: {a.revokeReason}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(app.phase === "draft" || app.phase === "automatic_checks_failed") && (
        <p className="font-body-sm">
          <Link href="/app/manufacturer/onboarding" className="text-primary font-semibold">Continue in company registration wizard</Link>
        </p>
      )}
    </OnboardingChrome>
  );
}
