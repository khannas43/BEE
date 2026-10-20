"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { Submitted } from "@/lib/client/agencyRegistration";

/** Shown after the Company Registration Form is submitted: the Reference ID and the next step. Local demonstration, nothing is sent by email. */
export default function AgencySubmittedPage() {
  const raw = useSyncExternalStore(() => () => {}, () => { try { return sessionStorage.getItem("agency-registration") ?? ""; } catch { return ""; } }, () => undefined);
  const data = raw === undefined ? undefined : raw ? (JSON.parse(raw) as Submitted) : null;
  if (data === undefined) return <p role="status" className="p-space-md">Loading…</p>;
  return (
    <main className="mx-auto max-w-2xl space-y-space-md p-space-md lg:p-space-lg" data-testid="agency-submitted">
      <div role="heading" aria-level={1} className="text-2xl font-extrabold text-on-surface">Agency details submitted. Thank you!</div>
      {data ? (
        <div className="rounded-2xl border border-border-subtle bg-surface-container-lowest p-space-lg space-y-2 text-sm">
          <p>Your Reference ID is</p>
          <p className="font-mono text-2xl font-extrabold text-primary" data-testid="agency-reference">{data.reference}</p>
          <p>{data.firm} · {data.equipment}</p>
          <p className="text-on-surface-variant">A copy would be sent to {data.email}. Note the Reference ID; you need it to pay the registration fee. Nothing is emailed in this local demonstration.</p>
        </div>
      ) : <p className="text-sm text-on-surface-variant">Your Reference ID was shown once, right after submitting. Use it on the payment page.</p>}
      <Link href="/register/agency/pay" className="inline-block rounded-lg !bg-primary px-6 py-2.5 font-label-md font-semibold !text-on-primary" data-testid="pay-link">Pay Registration Fee</Link>
    </main>
  );
}
