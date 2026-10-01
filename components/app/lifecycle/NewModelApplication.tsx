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
import { previewModelApplicationSubmit, submitModelApplicationDraft, type SubmitPreview, type SubmissionFee } from "@/lib/client/runtimeModelSubmit";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

type Brand = { brandId: string; brandName: string; principalOrganisation: string };

/** WP05.1b–c: create, edit and submit a draft through the BFF (provisional local-demo fee only). */
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
  const [submitPreview, setSubmitPreview] = useState<SubmitPreview | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitDone, setSubmitDone] = useState<{ reference: string; id: string; fee: SubmissionFee } | null>(null);
  const idemGate = useRef(new DraftIdempotencyGate());
  const submitIdem = useRef<string | null>(null);

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
    const nextVersion = res.application.version as number;
    setVersion(nextVersion);
    setSaved({ reference: String(res.application.reference), id: String(res.application.id) });
  }

  async function openSubmitConfirm(appId: string) {
    setSubmitError(null);
    setLoading(true);
    const prev = await previewModelApplicationSubmit(appId);
    setLoading(false);
    if (!prev.ok) {
      setSubmitError(prev.failure.message);
      return;
    }
    setSubmitPreview(prev.preview);
    setSubmitOpen(true);
  }

  async function confirmSubmit(appId: string) {
    if (!submitPreview) return;
    setLoading(true);
    setSubmitError(null);
    if (!submitIdem.current) submitIdem.current = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    const res = await submitModelApplicationDraft(appId, submitPreview.version, submitIdem.current);
    setLoading(false);
    if (!res.ok) {
      setSubmitError(res.failure.message);
      return;
    }
    submitIdem.current = null;
    setSubmitOpen(false);
    setSubmitDone({ reference: res.application.reference, id: res.application.id, fee: res.submissionFee });
  }

  const activeId = editId ?? saved?.id ?? null;

  if (submitDone) {
    return (
      <ScreenChrome module={module} screen={screen} subtitle="Submitted for fee" implemented={implemented}>
        <Card data-testid="model-submit-success">
          <p className="font-body-md text-body-md">
            Application <strong>{submitDone.reference}</strong> is now <strong>{stateLabel("fee_due")}</strong>.
          </p>
          <p className="font-body-sm text-on-surface-variant mt-space-sm">
            {submitDone.fee.label}: ₹{Number(submitDone.fee.amountInr).toLocaleString("en-IN")} ({submitDone.fee.feeRuleKey} v{submitDone.fee.feeRuleVersion}).
            {submitDone.fee.localDemoFee ? " This amount is for local demo only and is not a BEE-approved fee." : ""}
          </p>
          <p className="font-label-sm text-on-surface-variant mt-space-sm">
            Test evidence, accreditation and full RFP intake checks are not part of this step (deferred to WP05.1 / WP06.1).
          </p>
          <Link href={modelDashboardHref(submitDone.id)} className="inline-flex mt-space-md text-primary font-label-md">
            Refresh dashboard
          </Link>
        </Card>
      </ScreenChrome>
    );
  }

  if (saved && !isEdit) {
    return (
      <ScreenChrome module={module} screen={screen} subtitle="Draft saved" implemented={implemented}>
        <Card>
          <p className="font-body-md text-body-md">
            Draft <strong>{saved.reference}</strong> was saved.
          </p>
          {submitError && <p className="text-error font-body-sm mt-space-sm" data-testid="model-submit-error">{submitError}</p>}
          <div className="flex flex-col gap-space-sm mt-space-md">
            <button
              type="button"
              disabled={loading}
              className="w-full bg-primary text-on-primary py-2.5 rounded-lg font-label-md disabled:opacity-50"
              data-testid="model-draft-submit"
              onClick={() => openSubmitConfirm(saved.id)}
            >
              {loading ? "Loading…" : "Review submit and provisional fee"}
            </button>
            <Link href={modelDraftFormHref(saved.id)} className="text-center text-primary font-label-md">
              Edit draft first
            </Link>
            <Link href={modelDashboardHref(saved.id)} className="text-center text-on-surface-variant font-label-sm">
              View on dashboard
            </Link>
          </div>
          {submitOpen && submitPreview ? (
            <SubmitConfirmCard
              preview={submitPreview}
              loading={loading}
              error={submitError}
              onCancel={() => { setSubmitOpen(false); setSubmitError(null); }}
              onConfirm={() => confirmSubmit(saved.id)}
            />
          ) : null}
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
            {isEdit && activeId ? (
              <>
                {submitError && !submitOpen ? (
                  <p className="text-error font-body-sm" data-testid="model-submit-error">{submitError}</p>
                ) : null}
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => openSubmitConfirm(activeId)}
                  className="w-full border border-primary text-primary py-2.5 rounded-lg font-label-md disabled:opacity-50"
                  data-testid="model-draft-submit"
                >
                  {loading && submitOpen ? "Loading…" : "Review submit and provisional fee"}
                </button>
              </>
            ) : null}
            {submitOpen && submitPreview && activeId ? (
              <SubmitConfirmCard
                preview={submitPreview}
                loading={loading}
                error={submitError}
                onCancel={() => { setSubmitOpen(false); setSubmitError(null); }}
                onConfirm={() => confirmSubmit(activeId)}
              />
            ) : null}
            <p className="font-label-sm text-on-surface-variant text-center">
              Finance confirmation, rating and approval are not offered on this screen. Submit stores a provisional fee snapshot for local demo when rules allow.
            </p>
          </>
        )}
      </div>
    </ScreenChrome>
  );
}

function SubmitConfirmCard({
  preview,
  loading,
  error,
  onCancel,
  onConfirm,
}: {
  preview: SubmitPreview;
  loading: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Card title="Confirm submit" data-testid="model-submit-confirm">
      <p className="font-body-sm text-on-surface-variant">{preview.intakeNote}</p>
      {!preview.ready || !preview.submissionFee ? (
        <p className="text-error font-body-sm mt-space-sm">This draft is not ready to submit. Check brand authorisation and master rules.</p>
      ) : (
        <div className="mt-space-md space-y-1 font-body-sm">
          <p>
            <span className="font-semibold">{preview.submissionFee.label}</span>
            {" · "}
            ₹{Number(preview.submissionFee.amountInr).toLocaleString("en-IN")} {preview.submissionFee.currency}
          </p>
          <p className="text-on-surface-variant">
            Rule {preview.submissionFee.feeRuleKey} v{preview.submissionFee.feeRuleVersion} ({preview.submissionFee.verificationStatus}).
            {preview.submissionFee.localDemoFee ? " Not a BEE-approved fee." : ""}
          </p>
        </div>
      )}
      {error ? <p className="text-error font-body-sm mt-space-sm">{error}</p> : null}
      <div className="flex gap-space-sm mt-space-md">
        <button type="button" className="flex-1 py-2 rounded-lg border border-outline font-label-md" onClick={onCancel} disabled={loading}>
          Cancel
        </button>
        <button
          type="button"
          className="flex-1 py-2 rounded-lg bg-primary text-on-primary font-label-md disabled:opacity-50"
          data-testid="model-submit-confirm"
          disabled={loading || !preview.ready || !preview.submissionFee}
          onClick={onConfirm}
        >
          {loading ? "Submitting…" : "Submit to fee due"}
        </button>
      </div>
    </Card>
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
