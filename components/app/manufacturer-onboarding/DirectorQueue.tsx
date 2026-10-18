"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { NavLinks, OnboardingChrome } from "./shared";

/** Automatic activation removed the pre-approval queue. */
export function DirectorQueue() {
  const navLinks = [
    { href: "/app/manufacturer/monitoring", label: "Observation monitoring", testId: "nav-monitoring" },
  ];

  return (
    <OnboardingChrome icon="verified_user" title="Director — manufacturer observation oversight">
      <NavLinks links={navLinks} />
      <section className="bg-surface-card rounded-xl shadow-sm p-space-lg space-y-space-md" data-testid="director-automatic-activation-note">
        <div className="flex items-center gap-2 text-success">
          <Icon name="bolt" size={24} />
          <h2 className="font-headline-sm">Registration activation is automatic</h2>
        </div>
        <p className="font-body-md text-on-surface-variant">
          After payment and automated eligibility checks pass, the manufacturer is activated immediately. No Director pre-approval is required.
        </p>
        <p className="font-body-md text-on-surface-variant">
          The Director, Programme and Finance receive the registration for information. During the 15-day observation window, an anomaly places the registration on immediate hold; the Director may clear the hold or revoke the registration with a recorded reason.
        </p>
        <Link
          href="/app/manufacturer/monitoring"
          className="inline-flex items-center gap-1 rounded-lg bg-primary text-on-primary px-4 py-2 font-semibold"
          data-testid="director-open-monitoring"
        >
          Open observation monitoring <Icon name="arrow_forward" size={18} />
        </Link>
      </section>
    </OnboardingChrome>
  );
}
