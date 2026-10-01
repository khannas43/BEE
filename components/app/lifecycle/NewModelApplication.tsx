"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Card, ScreenChrome } from "@/components/app/ScreenScaffold";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { Module, Screen } from "@/lib/screens";

type Brand = { brandId: string; brandName: string; principalOrganisation: string };

/** WP05.1b: save a draft through the BFF; submit and fee steps stay prototype-only elsewhere. */
export function NewModelApplication({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ reference: string; id: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (identity.status !== "signed-in") return;
    fetch("/api/runtime/model-applications/eligible-brands", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((b) => {
        if (Array.isArray(b.items)) {
          setBrands(b.items);
          if (b.items[0]) setBrandId(b.items[0].brandId);
        }
      })
      .catch(() => setError("Could not load eligible brands."));
  }, [identity.status]);

  async function saveDraft() {
    setLoading(true);
    setError(null);
    const body = JSON.stringify({ brandId, category: "RAC", modelNumber: modelNumber.trim() });
    const key = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    const res = await fetch("/api/runtime/model-applications", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body,
    });
    const data = await res.json().catch(() => null);
    setLoading(false);
    if (!res.ok) {
      setError(data?.message ?? "Could not save the draft.");
      return;
    }
    setSaved({ reference: data.reference, id: data.id });
  }

  if (saved) {
    return (
      <ScreenChrome module={module} screen={screen} subtitle="Draft saved">
        <Card>
          <p className="font-body-md text-body-md">Draft <strong>{saved.reference}</strong> was saved. Submit and fee confirmation are not available on this screen yet.</p>
          <Link href={`/app/model-label/model-dashboard?id=${encodeURIComponent(saved.id)}`} className="inline-flex mt-space-md text-primary font-label-md">View on dashboard</Link>
        </Card>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Save a draft model application">
      <div className="max-w-lg space-y-space-md" data-testid="model-draft-form">
        {identity.status === "loading" && <p className="text-on-surface-variant">Checking your sign-in…</p>}
        {identity.status === "signed-out" && <p className="text-on-surface-variant">Sign in to save a draft.</p>}
        {identity.status === "signed-in" && (
          <>
            <Card title="Brand and model">
              <div className="space-y-space-md">
                <label className="block font-label-sm text-label-sm text-on-surface-variant">
                  Brand
                  <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="model-draft-brand">
                    {brands.map((b) => (
                      <option key={b.brandId} value={b.brandId}>{b.brandName} ({b.principalOrganisation})</option>
                    ))}
                  </select>
                </label>
                <label className="block font-label-sm text-label-sm text-on-surface-variant">
                  Model number
                  <input value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm" data-testid="model-draft-model-number" />
                </label>
              </div>
            </Card>
            {error && <p className="text-error font-body-sm" data-testid="model-draft-error">{error}</p>}
            <button type="button" disabled={loading || !brandId || !modelNumber.trim()} onClick={saveDraft} className="w-full bg-primary text-on-primary py-2.5 rounded-lg font-label-md disabled:opacity-50" data-testid="model-draft-save">
              {loading ? "Saving…" : "Save draft"}
            </button>
            <p className="font-label-sm text-on-surface-variant text-center">Records are stored in the BEE service. Submit, fees, rating and approval are not offered here.</p>
          </>
        )}
      </div>
    </ScreenChrome>
  );
}
