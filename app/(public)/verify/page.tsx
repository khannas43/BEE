"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { VERIFICATION_COPY, type VerificationResult, readPublicVerification } from "@/lib/client/runtimeVerification";

/**
 * The public certificate check (WP09.1c; the owner's assumption D8, not BEE's decision). Anyone can open it, from a QR code or by typing a
 * registration ID. It asks the portal's public route and shows only what that route returns: the registration ID, manufacturer, brand and
 * model, category, stars, efficiency figure and validity. A local demonstration, never a BEE certificate, and it says so on every result.
 */
function useVerification(reg: string | null): VerificationResult | "loading" | null {
  const [answer, setAnswer] = useState<{ reg: string; result: VerificationResult } | null>(null);
  useEffect(() => {
    if (!reg) return;
    let live = true;
    void readPublicVerification(reg).then((result) => {
      if (live) setAnswer({ reg, result });
    });
    return () => {
      live = false;
    };
  }, [reg]);
  if (!reg) return null;
  return answer?.reg === reg ? answer.result : "loading";
}

function VerifyInner() {
  const router = useRouter();
  const reg = useSearchParams().get("reg")?.trim() || null;
  const [typed, setTyped] = useState(reg ?? "");
  const result = useVerification(reg);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = typed.trim();
    router.push(v ? `/verify?reg=${encodeURIComponent(v)}` : "/verify");
  }

  return (
    <div className="max-w-2xl mx-auto px-gutter py-space-2xl" data-testid="verify-screen">
      <div className="text-center mb-space-xl">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-forest-light text-forest-dark font-label-sm text-label-sm uppercase tracking-wider mb-space-sm">
          <Icon name="verified_user" size={16} fill /> Public check
        </div>
        <h1 className="font-headline-xl text-headline-xl text-on-surface" data-testid="verify-heading">{VERIFICATION_COPY.heading}</h1>
        <p className="font-body-lg text-body-lg text-on-surface-variant mt-2" data-testid="verify-intro">{VERIFICATION_COPY.intro}</p>
      </div>

      <form onSubmit={submit} className="bg-surface-card rounded-xl shadow-md p-space-lg flex flex-col sm:flex-row gap-space-sm">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={VERIFICATION_COPY.placeholder}
          aria-label="Registration ID"
          maxLength={40}
          className="flex-1 px-4 py-3 rounded-lg bg-surface-container-low font-body-md text-body-md outline-none focus:bg-surface-card shadow-inner"
          data-testid="verify-input"
        />
        <button type="submit" className="bg-primary text-on-primary px-space-lg py-3 rounded-lg font-label-lg text-label-lg inline-flex items-center gap-1.5" data-testid="verify-run">
          <Icon name="search" size={18} /> Verify
        </button>
      </form>

      {result ? <Result result={result} /> : null}
    </div>
  );
}

function Result({ result }: { result: VerificationResult | "loading" }) {
  if (result === "loading") {
    return <p className="mt-space-lg text-center font-body-md text-on-surface-variant" data-testid="verify-result" data-outcome="loading">Checking…</p>;
  }
  if (result.outcome === "found") {
    const c = result.certificate;
    const tone = c.status === "valid" ? "border-primary/40 bg-primary/5" : "border-error/40 bg-error/5";
    return (
      <div className={`mt-space-lg rounded-xl border ${tone} p-space-lg`} data-testid="verify-result" data-outcome={c.status}>
        <p className="font-title-lg text-title-lg text-on-surface" data-testid="verify-status">{VERIFICATION_COPY.statusText[c.status]}</p>
        <p className="font-mono font-title-md text-title-md mt-1" data-testid="verify-registration">{c.registrationId}</p>
        <dl className="grid grid-cols-2 gap-x-space-lg gap-y-space-xs mt-space-md font-body-md text-body-md">
          <dt className="text-on-surface-variant">Manufacturer</dt>
          <dd data-testid="verify-manufacturer">{c.manufacturer}</dd>
          <dt className="text-on-surface-variant">Brand and model</dt>
          <dd data-testid="verify-model">{c.brandName} {c.modelNumber}</dd>
          <dt className="text-on-surface-variant">Category</dt>
          <dd data-testid="verify-category">{c.category}</dd>
          <dt className="text-on-surface-variant">Star rating</dt>
          <dd data-testid="verify-rating">{"★".repeat(c.stars)}{"☆".repeat(5 - c.stars)} ({c.stars}) · efficiency {c.verifiedIseer}</dd>
          <dt className="text-on-surface-variant">Valid</dt>
          <dd data-testid="verify-validity">{c.validFrom} to {c.validTo}</dd>
        </dl>
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-md" data-testid="verify-demo">{VERIFICATION_COPY.demo}</p>
      </div>
    );
  }
  const text = result.outcome === "not_found" ? VERIFICATION_COPY.notFound : result.outcome === "empty" ? VERIFICATION_COPY.empty : VERIFICATION_COPY.unavailable;
  return (
    <div className="mt-space-lg rounded-xl border border-error/40 bg-error/5 p-space-lg" data-testid="verify-result" data-outcome={result.outcome}>
      <p className="font-body-md text-body-md" data-testid="verify-message">{text}</p>
      <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-sm">{VERIFICATION_COPY.demo}</p>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto px-gutter py-space-2xl">Loading…</div>}>
      <VerifyInner />
    </Suspense>
  );
}
