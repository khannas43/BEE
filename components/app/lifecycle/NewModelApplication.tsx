"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Card, ScreenChrome } from "@/components/app/ScreenScaffold";
import { orgsText, rolesText, useSpringIdentity } from "@/components/app/SessionBadge";
import {
  createModelApplicationDraft,
  DraftIdempotencyGate,
  modelDraftFormHref,
  patchModelApplicationDraft,
} from "@/lib/client/runtimeModelDrafts";
import { modelDashboardHref, readModelApplication, stateLabel } from "@/lib/client/runtimeModelApplications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

type Brand = { brandId: string; brandName: string; principalOrganisation: string };

/** WP05.1b: create or edit a draft through the BFF; submit and fee steps stay unavailable. */
export function NewModelApplication({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const params = useSearchParams();
  const editId = params.get("edit");

  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [version, setVersion] = useState(0);
  const [reference, setReference] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ reference: string; id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [legacyUnlinked, setLegacyUnlinked] = useState(false);
  const idemGate = useRef(new DraftIdempotencyGate());

  const implemented = runtimeRouteFor("/app/model-label/new-model-application")?.implemented;
  const isEdit = !!editId;

  useEffect(() => {
    if (identity.status !== "signed-in") return;
    fetch("/api/runtime/model-applications/eligible-brands", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((b) => {
        if (Array.isArray(b.items)) {
          setBrands(b.items);
        }
      })
      .catch(() => setError("Could not load eligible brands."));
  }, [identity.status]);

  useEffect(() => {
    if (!editId || identity.status !== "signed-in") return;
    let live = true;
    readModelApplication(editId).then((r) => {
      if (!live) return;
      if (!r.ok) {
        setLoadError(r.failure.message);
        return;
      }
      if (r.application.state !== "draft") {
        setLoadError("Only draft applications can be edited.");
        return;
      }
      setReference(r.application.reference);
      setModelNumber(r.application.modelNumber);
      setVersion(r.application.version);
      const bid = (r.application as { brandId?: string }).brandId;
      if (bid) {
        setBrandId(bid);
        setLegacyUnlinked(false);
      } else {
        setLegacyUnlinked(true);
        setBrandId("");
      }
    });
    return () => {
      live = false;
    };
  }, [editId, identity.status]);

  useEffect(() => {
    if (isEdit || brandId || !brands.length) return;
    setBrandId(brands[0].brandId);
  }, [brands, brandId, isEdit]);

  const createPayload = useMemo(
    () => ({ brandId, category: "RAC" as const, modelNumber: modelNumber.trim() }),
    [brandId, modelNumber],
  );

  async function saveDraft() {
    setLoading(true);
    setError(null);
    const patchBody = {
      version,
      category: "RAC" as const,
      modelNumber: modelNumber.trim(),
      ...(brandId ? { brandId } : {}),
    };
    const key = idemGate.current.keyFor(isEdit ? { ...patchBody, editId } : createPayload);
    const res = isEdit && editId
      ? await patchModelApplicationDraft(editId, patchBody, key)
      : await createModelApplicationDraft(createPayload, key);
    setLoading(false);
    if (!res.ok) {
      setError(res.failure.message);
      return;
    }
    idemGate.current.clear();
    setSaved({ reference: String(res.application.reference), id: String(res.application.id) });
  }

  if (saved) {
    return (
      <ScreenChrome module={module} screen={screen} subtitle={isEdit ? "Draft updated" : "Draft saved"} implemented={implemented}>
        <Card>
          <p className="font-body-md text-body-md">
            Draft <strong>{saved.reference}</strong> was saved. Submit and fee confirmation are not available on this screen yet.
          </p>
          <Link href={modelDashboardHref(saved.id)} className="inline-flex mt-space-md text-primary font-label-md">
            View on dashboard
          </Link>
        </Card>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome
      module={module}
      screen={screen}
      subtitle={isEdit ? "Edit a draft model application" : "Create a draft model application"}
      implemented={implemented}
      actions={
        <Link href={modelDashboardHref()} className="font-label-sm text-label-sm text-primary hover:underline inline-flex items-center gap-1">
          My applications <Icon name="arrow_forward" size={14} />
        </Link>
      }
    >
      <div className="max-w-lg space-y-space-md" data-testid="model-draft-form">
        <IdentityStrip identity={identity} />
        {identity.status === "loading" && <p className="text-on-surface-variant">Checking your sign-in…</p>}
        {identity.status === "signed-out" && <p className="text-on-surface-variant">Sign in to save a draft.</p>}
        {loadError && <p className="text-error font-body-sm" data-testid="model-draft-load-error">{loadError}</p>}
        {identity.status === "signed-in" && !loadError && (
          <>
            {isEdit && reference ? (
              <p className="font-label-sm text-on-surface-variant">
                Editing <span className="font-mono">{reference}</span> · {stateLabel("draft")} · version {version}
              </p>
            ) : null}
            <Card title="Brand and model">
              <div className="space-y-space-md">
                <label className="block font-label-sm text-label-sm text-on-surface-variant">
                  Brand
                  <select
                    value={brandId}
                    onChange={(e) => setBrandId(e.target.value)}
                    className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
                    data-testid="model-draft-brand"
                  >
                    {legacyUnlinked ? (
                      <option value="">Select a brand (required if the stored name is ambiguous)</option>
                    ) : null}
                    {brands.map((b) => (
                      <option key={b.brandId} value={b.brandId}>
                        {b.brandName} ({b.principalOrganisation})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block font-label-sm text-label-sm text-on-surface-variant">
                  Model number
                  <input
                    value={modelNumber}
                    onChange={(e) => setModelNumber(e.target.value)}
                    className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
                    data-testid="model-draft-model-number"
                  />
                </label>
              </div>
            </Card>
            {error && (
              <p className="text-error font-body-sm" data-testid="model-draft-error">
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={loading || !modelNumber.trim() || (isEdit && !editId) || (!isEdit && !brandId)}
              onClick={saveDraft}
              className="w-full bg-primary text-on-primary py-2.5 rounded-lg font-label-md disabled:opacity-50"
              data-testid="model-draft-save"
            >
              {loading ? "Saving…" : isEdit ? "Save changes" : "Save draft"}
            </button>
            <p className="font-label-sm text-on-surface-variant text-center">
              Records are stored in the BEE service. Submit, fees, rating and approval are not offered here.
            </p>
          </>
        )}
      </div>
    </ScreenChrome>
  );
}

function IdentityStrip({ identity }: { identity: ReturnType<typeof useSpringIdentity> }) {
  return (
    <Card>
      <div className="flex items-start gap-space-sm" data-testid="model-draft-identity">
        <Icon name="badge" size={20} className="text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">Signed-in identity (BEE records)</div>
          {identity.status === "loading" ? (
            <p className="font-body-sm text-on-surface-variant mt-1">Checking your sign-in…</p>
          ) : identity.status === "signed-out" ? (
            <p className="font-body-sm text-on-surface mt-1">No signed-in BEE identity with an active role.</p>
          ) : (
            <p className="font-body-sm text-on-surface mt-1">
              <span className="font-semibold">{identity.me.displayName}</span>
              {" · "}
              {rolesText(identity.me)}
              {orgsText(identity.me) ? ` · ${orgsText(identity.me)}` : ""}
            </p>
          )}
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">
            The development preview role above is not your identity and does not grant access to these records.
          </p>
        </div>
      </div>
    </Card>
  );
}
