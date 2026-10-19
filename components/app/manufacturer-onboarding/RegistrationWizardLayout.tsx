"use client";

import type { ReactNode } from "react";
import { PublicHeader } from "@/components/chrome/PublicHeader";
import { Icon } from "@/components/ui/Icon";
import type { ManufacturerApplication } from "@/lib/manufacturer-onboarding/types";
import { PhaseStatus } from "./shared";
import { MANUFACTURER_REGISTRATION_STEPS } from "./wizardSteps";

export type RegistrationWizardStepDef = {
  id: string;
  title: string;
  icon: string;
};

type Props = {
  appRecord: ManufacturerApplication | null;
  step: number;
  onStepChange: (index: number) => void;
  children: ReactNode;
  /** When false, the public site layout already renders {@link PublicHeader} (e.g. `/register/manufacturer`). */
  showPublicHeader?: boolean;
  steps?: readonly RegistrationWizardStepDef[];
  sidebarHeading?: string;
  sidebarHint?: string;
  /** Guest account page uses header + form only (no step rail). */
  showSidebar?: boolean;
};

function stepButtonClass(active: boolean) {
  return active
    ? "bg-primary-container text-on-primary font-semibold"
    : "text-forest-light/85 hover:text-on-primary hover:bg-white/5";
}

export function RegistrationWizardLayout({
  appRecord,
  step,
  onStepChange,
  children,
  showPublicHeader = true,
  steps = MANUFACTURER_REGISTRATION_STEPS,
  sidebarHeading = "Application steps",
  sidebarHint = "Complete each section to submit your registration.",
  showSidebar = true,
}: Props) {
  const showStepNav = showSidebar && steps.length > 1;
  const body = (
    <>
      {appRecord && (
        <div className="shrink-0 border-b border-border-subtle bg-surface-card px-space-md lg:px-space-lg py-2 flex flex-wrap items-center justify-end gap-2">
          <span className="font-mono text-xs text-on-surface-variant">{appRecord.reference}</span>
          <PhaseStatus phase={appRecord.phase} />
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        {showStepNav && (
        <aside className="hidden lg:flex w-72 shrink-0 flex-col bg-forest-dark text-forest-light">
          <div className="px-space-md py-3 border-b border-white/10">
            <p className="text-[10px] font-label-sm uppercase tracking-[0.12em] text-forest-light/75">{sidebarHeading}</p>
            <p className="text-xs text-forest-light/60 mt-1 leading-snug">{sidebarHint}</p>
          </div>
          <nav className="flex-1 overflow-y-auto app-scroll py-space-sm" aria-label="Registration steps">
            <ol className="space-y-0" data-testid="onboarding-stepper">
              {steps.map((s, i) => {
                const active = i === step;
                const done = i < step;
                const navigable = steps.length > 1;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={!navigable}
                      onClick={() => navigable && onStepChange(i)}
                      className={`w-full flex items-center gap-2 pl-6 pr-3 py-2 text-left text-xs leading-snug transition-colors disabled:cursor-default ${stepButtonClass(active)}`}
                      data-testid={`step-${s.id}`}
                      aria-current={active ? "step" : undefined}
                    >
                      <Icon
                        name={done ? "check_circle" : s.icon}
                        size={16}
                        className={active ? "text-solar-gold" : done ? "text-forest-light/50" : "text-forest-light/40"}
                        fill={active}
                      />
                      <span className="flex-1">
                        <span className="text-forest-light/50 mr-1">{i + 1}.</span>
                        {s.title}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>
        )}

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          {showStepNav && (
            <div className="lg:hidden shrink-0 border-b border-border-subtle bg-surface-card overflow-x-auto app-scroll">
              <div className="flex gap-1 p-2 min-w-max" role="tablist" aria-label="Registration steps">
                {steps.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={i === step}
                    onClick={() => onStepChange(i)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition-colors ${
                      i === step ? "bg-primary text-on-primary font-semibold" : "bg-surface-container-low text-on-surface-variant"
                    }`}
                  >
                    {i + 1}. {s.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto app-scroll bg-gradient-to-b from-surface-ground via-surface-ground to-surface-container-lowest/80">
            <div className="w-full p-space-md lg:p-space-lg">{children}</div>
          </div>
        </main>
      </div>
    </>
  );

  if (showPublicHeader) {
    return (
      <div className="min-h-screen flex flex-col bg-surface-ground" data-testid="registration-wizard-shell">
        <PublicHeader />
        <div className="flex flex-col flex-1 min-h-0 pt-[196px]">{body}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100dvh-196px)] bg-surface-ground w-full" data-testid="registration-wizard-shell">
      {body}
    </div>
  );
}
