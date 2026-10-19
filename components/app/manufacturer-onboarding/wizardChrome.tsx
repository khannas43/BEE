"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

export const wizardInputClass =
  "w-full mt-1 rounded-lg border border-outline-variant/80 bg-surface px-3 py-2 text-sm font-body-sm shadow-sm transition-[border-color,box-shadow] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export function WizardStepHero({
  stepIndex,
  stepCount,
  title,
  blurb,
}: {
  stepIndex: number;
  stepCount: number;
  title: string;
  blurb: string;
}) {
  const progress = Math.round(((stepIndex + 1) / stepCount) * 100);
  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs font-label-sm text-primary uppercase tracking-[0.1em]">
            Step {stepIndex + 1} of {stepCount}
          </p>
          <h1 className="text-lg font-semibold text-on-surface mt-0.5" id="step-heading">
            {title}
          </h1>
        </div>
        <p className="font-mono text-xs text-on-surface-variant tabular-nums">{progress}% complete</p>
      </div>
      <div className="h-1 rounded-full bg-surface-container-high overflow-hidden" aria-hidden>
        <div className="h-full rounded-full bg-gradient-to-r from-primary to-forest-light transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>
      <p className="text-sm font-body-sm text-on-surface-variant">{blurb}</p>
    </header>
  );
}

export function WizardPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-border-subtle bg-surface-card shadow-sm p-space-md space-y-space-md ${className}`}
      aria-labelledby="step-heading"
    >
      {children}
    </section>
  );
}

export function WizardSection({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-space-md">
      <div className="flex items-start gap-2">
        {icon && <Icon name={icon} size={18} className="text-primary mt-0.5 shrink-0" />}
        <div>
          <h2 className="text-sm font-semibold text-on-surface">{title}</h2>
          {description && <p className="text-xs font-body-sm text-on-surface-variant mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function WizardFieldLabel({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <span className="text-xs font-label-sm text-on-surface">
      {children}
      {required && <span className="text-error ml-0.5" aria-hidden>*</span>}
    </span>
  );
}

export function WizardReadinessAside({
  issues,
}: {
  issues: string[];
}) {
  return (
    <aside
      className="rounded-2xl border border-border-subtle bg-gradient-to-br from-surface-container-lowest to-surface-container-low p-space-md shadow-sm"
      data-testid="validation-summary"
    >
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
          <Icon name="fact_check" size={16} className="text-primary" />
        </span>
        Readiness for submit
      </h3>
      {issues.length === 0 ? (
        <p className="font-body-sm text-success flex items-center gap-2">
          <Icon name="check_circle" size={18} />
          All required checks pass. You may submit on the final step.
        </p>
      ) : (
        <ul className="space-y-2 font-body-sm text-on-surface-variant">
          {issues.map((x) => (
            <li key={x} className="flex gap-2">
              <Icon name="radio_button_unchecked" size={16} className="shrink-0 mt-0.5 text-on-surface-variant/60" />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export function WizardNavFooter({
  step,
  stepCount,
  busy,
  issuesCount,
  issues = [],
  saveNote,
  submitError,
  onBack,
  onNext,
  onSave,
  onSubmit,
}: {
  step: number;
  stepCount: number;
  busy: boolean;
  issuesCount: number;
  /** The outstanding items, listed beside Submit so the applicant sees why it is disabled. */
  issues?: readonly string[];
  saveNote: string | null;
  submitError: string | null;
  onBack: () => void;
  onNext: () => void;
  onSave: () => void;
  onSubmit: () => void;
}) {
  const isLast = step >= stepCount - 1;
  return (
    <div className="space-y-2 pt-space-md border-t border-border-subtle">
      {isLast && issuesCount > 0 && (
        <div className="rounded-lg border border-error/40 bg-error-container/40 px-3 py-2 text-sm text-on-surface" role="status" data-testid="wizard-submit-blockers">
          <p className="font-semibold">Submit is available once {issuesCount === 1 ? "this item is" : `these ${issuesCount} items are`} done:</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={step === 0 || busy}
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-2 text-sm font-label-sm disabled:opacity-40 hover:bg-surface-container-low"
          data-testid="wizard-back"
        >
          <Icon name="arrow_back" size={18} />
          Back
        </button>
        {!isLast ? (
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-1 rounded-lg bg-primary text-on-primary px-3 py-2 text-sm font-label-sm font-semibold shadow-sm hover:opacity-95"
            data-testid="wizard-next"
          >
            Continue
            <Icon name="arrow_forward" size={18} />
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || issuesCount > 0}
            onClick={onSubmit}
            className="inline-flex items-center gap-1 rounded-lg bg-primary text-on-primary px-3 py-2 text-sm font-label-sm font-semibold shadow-sm disabled:opacity-40 hover:opacity-95"
            data-testid="wizard-submit"
          >
            <Icon name="send" size={18} />
            Submit registration
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="inline-flex items-center gap-1 rounded-lg border border-outline-variant px-3 py-2 text-sm font-label-sm hover:bg-surface-container-low disabled:opacity-40"
          data-testid="wizard-save"
        >
          <Icon name="save" size={18} />
          Save & resume later
        </button>
      </div>
      {saveNote && (
        <p className="font-body-sm text-on-surface-variant" role="status">
          {saveNote}
        </p>
      )}
      {submitError && (
        <p className="text-error font-body-sm flex items-center gap-1" role="alert">
          <Icon name="error" size={16} />
          {submitError}
        </p>
      )}
    </div>
  );
}
