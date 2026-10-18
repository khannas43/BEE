"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Emblem } from "@/components/chrome/Emblem";
import { DEMO_APPLICANT_IDENTITY, ONBOARDING_DISCLOSURE } from "@/lib/manufacturer-onboarding/types";
import { OperationalFlowNote } from "@/components/app/manufacturer-onboarding/shared";

/** Public introduction — optimized manufacturer onboarding demo entry. */
export default function RegisterManufacturerPage() {
  return (
    <div className="min-h-screen bg-surface-ground">
      <header className="border-b bg-surface-card px-space-md py-space-sm flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2">
          <Emblem size={36} />
          <span className="font-headline-sm text-headline-sm">BEE S&amp;L Portal</span>
        </Link>
      </header>
      <main className="max-w-2xl mx-auto p-space-md lg:p-space-lg space-y-space-md">
        <h1 className="font-display-md text-display-md font-bold" data-testid="register-manufacturer-title">
          Create applicant login
        </h1>
        <p className="font-body-lg text-on-surface-variant">
          Start the optimized manufacturer / company registration journey. This screen does not dynamically create arbitrary Keycloak users — Agent A will seed the demonstration applicant below. Production self-service account creation remains deferred.
        </p>

        <section className="rounded-xl border bg-surface-card p-space-md space-y-2" data-testid="demo-applicant-identity">
          <h2 className="font-headline-sm text-headline-sm">Demonstration applicant identity (seeded)</h2>
          <dl className="grid sm:grid-cols-2 gap-2 font-body-md">
            <div>
              <dt className="text-on-surface-variant font-label-sm">Username</dt>
              <dd className="font-mono font-semibold">{DEMO_APPLICANT_IDENTITY.username}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant font-label-sm">Password</dt>
              <dd className="font-mono">{DEMO_APPLICANT_IDENTITY.password}</dd>
            </div>
          </dl>
          <p className="font-body-sm text-on-surface-variant">{DEMO_APPLICANT_IDENTITY.label}</p>
        </section>

        <div className="rounded-xl border border-solar-gold/40 bg-solar-gold-light/40 p-space-sm flex gap-2" role="note">
          <Icon name="info" size={20} className="shrink-0 text-solar-gold-dark" />
          <p className="font-body-sm">{ONBOARDING_DISCLOSURE}</p>
        </div>

        <OperationalFlowNote />

        <div className="flex flex-col sm:flex-row gap-3">
          <Link
            href="/login?returnTo=/app/manufacturer/onboarding"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary text-on-primary font-semibold py-3 px-space-md hover:bg-forest-dark"
            data-testid="sign-in-demo-applicant"
          >
            Sign in with demonstration applicant <Icon name="login" size={18} />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-outline-variant py-3 px-space-md font-semibold"
            data-testid="continue-to-sign-in"
          >
            General sign-in
          </Link>
        </div>
      </main>
    </div>
  );
}
