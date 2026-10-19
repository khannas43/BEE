"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { DemoShell, Pill } from "@/components/app/demo/DemoShell";
import { ONBOARDING_DISCLOSURE } from "@/lib/manufacturer-onboarding/types";
import { ANOMALY_FLOW, OPERATIONAL_FLOW, phaseLabel, phaseTone } from "@/lib/manufacturer-onboarding/statusLabels";
import type { ManufacturerLifecyclePhase } from "@/lib/manufacturer-onboarding/types";
import { istStamp } from "@/lib/client/istTime";

export function OnboardingDisclosure() {
  return (
    <div className="rounded-xl border border-solar-gold/40 bg-solar-gold-light/40 p-space-sm flex gap-space-sm" role="note" data-testid="onboarding-disclosure">
      <Icon name="info" size={20} className="text-solar-gold-dark shrink-0 mt-0.5" />
      <p className="font-body-sm text-body-sm text-on-surface">{ONBOARDING_DISCLOSURE}</p>
    </div>
  );
}

export function OperationalFlowNote() {
  return (
    <div className="space-y-2 font-body-sm text-body-sm text-on-surface-variant" data-testid="operational-flow">
      <p>{OPERATIONAL_FLOW}</p>
      <p>{ANOMALY_FLOW}</p>
    </div>
  );
}

const TONE_ICON: Record<ReturnType<typeof phaseTone>, string> = {
  neutral: "draft",
  warn: "schedule",
  ok: "verified",
  danger: "block",
};

export function PhaseStatus({ phase }: { phase: ManufacturerLifecyclePhase }) {
  const tone = phaseTone(phase);
  const label = phaseLabel(phase);
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="phase-status" data-phase={phase}>
      <Icon name={TONE_ICON[tone]} size={18} className="shrink-0" aria-hidden />
      <Pill>{label}</Pill>
    </span>
  );
}

export function SyntheticBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-on-surface-variant/50 px-2 py-0.5 text-label-sm font-label-sm text-on-surface-variant" data-testid="synthetic-badge">
      <Icon name="science" size={14} /> Synthetic demo record
    </span>
  );
}

export function SimulatedPaymentNote() {
  return (
    <p className="font-body-sm text-body-sm text-on-surface-variant" data-testid="simulated-payment-note">
      Payment gateway is <strong className="text-on-surface">simulated in demo mode</strong>. No live transaction is initiated.
    </p>
  );
}

export function AccessDeniedPanel({ homeHref = "/app" }: { homeHref?: string }) {
  return (
    <div className="p-space-md lg:p-space-lg max-w-lg mx-auto text-center" data-testid="onboarding-access-denied">
      <Icon name="lock" size={32} className="text-error mb-space-sm" />
      <h1 className="font-headline-sm text-headline-sm">Access not available</h1>
      <p className="font-body-md text-body-md text-on-surface-variant mt-2">
        This optimized manufacturer onboarding area is limited to Applicant, Director, Finance and Programme demonstration roles.
      </p>
      <Link href={homeHref} className="inline-flex items-center gap-1 mt-space-md text-primary font-semibold">
        <Icon name="arrow_back" size={16} /> Back
      </Link>
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="p-space-lg flex items-center justify-center gap-2 text-on-surface-variant" data-testid="onboarding-loading">
      <Icon name="progress_activity" size={22} className="animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="p-space-lg text-center" data-testid="onboarding-error">
      <Icon name="error" size={28} className="text-error mx-auto mb-2" />
      <p className="font-body-md text-body-md">{message}</p>
      <button type="button" onClick={onRetry} className="mt-space-md inline-flex items-center gap-1 font-label-md font-semibold py-2 px-space-md rounded-lg bg-primary text-on-primary hover:bg-forest-dark" data-testid="onboarding-retry">
        <Icon name="refresh" size={16} /> Retry
      </button>
    </div>
  );
}

export function EmptyState({ title, children, testId = "onboarding-empty" }: { title: string; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="p-space-lg text-center text-on-surface-variant" data-testid={testId}>
      <Icon name="inbox" size={32} className="mx-auto mb-2 opacity-60" />
      <p className="font-body-md text-body-md text-on-surface">{title}</p>
      {children}
    </div>
  );
}

export function OnboardingChrome({ icon, title, children, showDisclosure = true }: { icon: string; title: string; children: React.ReactNode; showDisclosure?: boolean }) {
  return (
    <DemoShell icon={icon}>
      <div className="p-space-md lg:p-space-lg max-w-7xl mx-auto space-y-space-md">
        <header className="space-y-2">
          <h1 className="font-headline-md text-headline-md text-on-surface flex flex-wrap items-center gap-2">{title}</h1>
          {showDisclosure && <OnboardingDisclosure />}
        </header>
        {children}
      </div>
    </DemoShell>
  );
}

export function IstDate({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <>—</>;
  return <time dateTime={iso}>{istStamp(iso)} IST</time>;
}

export function NavLinks({ links }: { links: { href: string; label: string; testId: string }[] }) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Manufacturer onboarding" data-testid="onboarding-nav">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          data-testid={l.testId}
          className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-1.5 text-label-md font-label-md hover:bg-surface-container-low"
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
