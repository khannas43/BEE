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

export function RegistrationWizardLayout({
  appRecord,
  step,
  onStepChange,
  children,
  showPublicHeader = false,
  steps = MANUFACTURER_REGISTRATION_STEPS,
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
        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          {showStepNav && (
            <nav className="shrink-0 border-b border-border-subtle bg-surface-card overflow-x-auto app-scroll" aria-label="Registration steps">
              <ol className="grid grid-cols-7 gap-1 px-space-md lg:px-space-lg py-3 min-w-[860px]" data-testid="onboarding-stepper">
                {steps.map((s, i) => {
                  const active = i === step;
                  const done = i < step;
                  return (
                    <li key={s.id} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onStepChange(i)}
                        className={`relative w-full h-full flex flex-col items-center gap-1.5 rounded-xl px-1.5 py-2 text-center text-xs leading-tight transition-colors ${
                          active
                            ? "bg-primary text-on-primary font-semibold shadow-sm"
                            : done
                              ? "bg-success-container/60 text-on-surface hover:bg-success-container"
                              : "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
                        }`}
                        data-testid={`step-${s.id}`}
                        aria-current={active ? "step" : undefined}
                      >
                        <span
                          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            active ? "bg-white/20 text-on-primary" : done ? "bg-success text-on-success" : "bg-surface-container-high text-on-surface-variant"
                          }`}
                        >
                          {done ? <Icon name="check" size={14} /> : i + 1}
                        </span>
                        <span>{s.title}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>
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
    <div className="flex flex-col min-h-full bg-surface-ground w-full" data-testid="registration-wizard-shell">
      {body}
    </div>
  );
}
