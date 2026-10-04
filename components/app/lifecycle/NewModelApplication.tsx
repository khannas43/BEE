"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useCommand } from "@/components/app/kit/CommandPanel";
import { Card, ScreenChrome } from "@/components/app/ScreenScaffold";
import { orgsText, rolesText, useSpringIdentity } from "@/components/app/SessionBadge";
import { commandAdvice, type CommandFailure, type CommandResult } from "@/lib/client/runtimeHttp";
import {
  createModelApplicationDraft,
  modelDraftFormHref,
  patchModelApplicationDraft,
  type DraftApplication,
  type DraftSaveResult,
} from "@/lib/client/runtimeModelDrafts";
import { modelDashboardHref, readModelApplication, stateLabel, type ModelApplication } from "@/lib/client/runtimeModelApplications";
import {
  previewModelApplicationSubmit,
  submitModelApplicationDraft,
  type ExpectedFeeSubmit,
  type SubmitPreview,
  type SubmittedApplication,
  type SubmissionFee,
} from "@/lib/client/runtimeModelSubmit";
import { DraftTestReports } from "@/components/app/lifecycle/DraftTestReports";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

type Brand = { brandId: string; brandName: string; principalOrganisation: string };
type Laboratory = { code: string; name: string };

/** Labels for the evidence checks, in the order the API reports them (provisional local defaults, not BEE rules). */
const GATE_LABELS: Record<string, string> = {
  test_report_required: "Test report uploaded",
  declared_efficiency_required: "Declared efficiency entered",
  test_date_invalid: "Test date entered and not in the future",
  laboratory_not_accredited: "Laboratory accredited for this category on the test date",
  standard_not_available: "Applicable standard in force on the test date",
  duplicate_model: "Brand and model number not already in use",
};

type Evidence = { laboratoryCode: string; testedOn: string; declaredIseer: string };
const NO_EVIDENCE: Evidence = { laboratoryCode: "", testedOn: "", declaredIseer: "" };

const ISEER_TEXT = /^\d{1,2}(\.\d{1,2})?$/;
const ISEER_MESSAGE = "Declared efficiency must be a positive number up to 99.99 with at most two decimals.";

/** Empty text means "not entered"; anything else must be a positive figure with at most two decimals, never silently dropped. */
function parseIseer(text: string): { ok: true; value: number | null } | { ok: false } {
  const t = text.trim();
  if (t === "") return { ok: true, value: null };
  if (!ISEER_TEXT.test(t)) return { ok: false };
  const value = Number(t);
  return value > 0 ? { ok: true, value } : { ok: false };
}

/** The write body for the evidence fields: an edit sends every field (an empty one clears it); a create sends only what is set. */
function evidenceBody(e: Evidence, iseer: number | null, isEdit: boolean) {
  const lab = e.laboratoryCode || null;
  const date = e.testedOn || null;
  if (isEdit) return { laboratoryCode: lab, testedOn: date, declaredIseer: iseer };
  return {
    ...(lab ? { laboratoryCode: lab } : {}),
    ...(date ? { testedOn: date } : {}),
    ...(iseer !== null ? { declaredIseer: iseer } : {}),
  };
}

type DraftSavePayload =
  | { mode: "create"; body: Parameters<typeof createModelApplicationDraft>[0] }
  | { mode: "patch"; editId: string; body: Parameters<typeof patchModelApplicationDraft>[1] };

const runDraftSave = async (payload: DraftSavePayload, key: string): Promise<CommandResult<DraftApplication>> => {
  const r: DraftSaveResult =
    payload.mode === "create"
      ? await createModelApplicationDraft(payload.body, key)
      : await patchModelApplicationDraft(payload.editId, payload.body, key);
  return r.ok
    ? { ok: true, value: r.application, replayed: r.replayed ?? false }
    : { ok: false, failure: r.failure, replayed: r.replayed ?? false };
};

const draftSaveSignature = (payload: DraftSavePayload) =>
  payload.mode === "patch" ? { ...payload.body, editId: payload.editId } : payload.body;

type SubmitCommandPayload = { appId: string; version: number; expectedFee: ExpectedFeeSubmit };
type SubmitCommandValue = { application: SubmittedApplication; submissionFee: SubmissionFee };

const runSubmit = async (payload: SubmitCommandPayload, key: string): Promise<CommandResult<SubmitCommandValue>> => {
  const r = await submitModelApplicationDraft(payload.appId, payload.version, payload.expectedFee, key);
  return r.ok
    ? { ok: true, value: { application: r.application, submissionFee: r.submissionFee }, replayed: r.replayed ?? false }
    : { ok: false, failure: r.failure, replayed: r.replayed ?? false };
};

const submitSignature = (payload: SubmitCommandPayload) => payload;

const DRAFT_FORM_RETURN_TO = "/app/model-label/new-model-application";

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
  const [previewLoading, setPreviewLoading] = useState(false);
  const [legacyUnlinked, setLegacyUnlinked] = useState(false);
  const [persistedDraft, setPersistedDraft] = useState<{ modelNumber: string; brandId: string; evidence: Evidence } | null>(null);
  const [laboratories, setLaboratories] = useState<Laboratory[]>([]);
  const [evidence, setEvidence] = useState<Evidence>(NO_EVIDENCE);
  const [submitPreview, setSubmitPreview] = useState<SubmitPreview | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitDone, setSubmitDone] = useState<{ reference: string; id: string; fee: SubmissionFee } | null>(null);
  const draftSave = useCommand(runDraftSave, draftSaveSignature);
  const submitCommand = useCommand(runSubmit, submitSignature);

  const implemented = runtimeRouteFor("/app/model-label/new-model-application")?.implemented;
  const isEdit = !!editId;
  const signInReturnTo =
    isEdit && editId
      ? `${DRAFT_FORM_RETURN_TO}?edit=${encodeURIComponent(editId)}`
      : DRAFT_FORM_RETURN_TO;
  const saveBusy = draftSave.state.phase === "busy";
  const submitBusy = submitCommand.state.phase === "busy";
  const draftCommandFailure = draftSave.state.phase === "failed" ? draftSave.state.failure : null;
  const submitCommandFailure = submitCommand.state.phase === "failed" ? submitCommand.state.failure : null;

  useEffect(() => {
    if (identity.status !== "signed-in") return;
    fetch("/api/runtime/model-applications/eligible-brands", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((b) => {
        if (Array.isArray(b.items)) {
          setBrands(b.items);
          if (!editId && b.items.length) {
            setBrandId((cur) => cur || b.items[0].brandId);
          }
        }
        if (Array.isArray(b.laboratories)) {
          setLaboratories(b.laboratories);
        }
      })
      .catch(() => setError("Could not load eligible brands."));
  }, [identity.status, editId]);

  const applyLoadedDraft = useCallback((application: ModelApplication) => {
    setReference(application.reference);
    setModelNumber(application.modelNumber);
    setVersion(application.version);
    const bid = application.brandId;
    if (bid) {
      setBrandId(bid);
      setLegacyUnlinked(false);
    } else {
      setLegacyUnlinked(true);
      setBrandId("");
    }
    const loaded: Evidence = {
      laboratoryCode: application.laboratoryCode ?? "",
      testedOn: application.testedOn ?? "",
      declaredIseer: application.declaredIseer === undefined ? "" : String(application.declaredIseer),
    };
    setEvidence(loaded);
    setPersistedDraft({ modelNumber: application.modelNumber, brandId: bid ?? "", evidence: loaded });
  }, []);

  const reloadDraftFromServer = useCallback(async () => {
    if (!editId) return;
    draftSave.reset();
    setError(null);
    const r = await readModelApplication(editId);
    if (!r.ok) {
      setLoadError(r.failure.message);
      return;
    }
    if (r.application.state !== "draft") {
      setLoadError("Only draft applications can be edited.");
      return;
    }
    applyLoadedDraft(r.application);
  }, [applyLoadedDraft, draftSave, editId]);

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
      applyLoadedDraft(r.application);
    });
    return () => {
      live = false;
    };
  }, [applyLoadedDraft, editId, identity.status]);

  const createPayload = useMemo(
    () => {
      const iseer = parseIseer(evidence.declaredIseer);
      return { brandId, category: "RAC" as const, modelNumber: modelNumber.trim(), ...evidenceBody(evidence, iseer.ok ? iseer.value : null, false) };
    },
    [brandId, modelNumber, evidence],
  );

  async function saveDraft() {
    const iseer = parseIseer(evidence.declaredIseer);
    if (!iseer.ok) {
      setError(ISEER_MESSAGE);
      return;
    }
    setError(null);
    const patchBody = {
      version,
      category: "RAC" as const,
      modelNumber: modelNumber.trim(),
      ...(brandId ? { brandId } : {}),
      ...evidenceBody(evidence, iseer.value, true),
    };
    const payload: DraftSavePayload =
      isEdit && editId ? { mode: "patch", editId, body: patchBody } : { mode: "create", body: createPayload };
    const res = await draftSave.execute(payload);
    if (!res?.ok) return;
    // A save changes the version, so any open submit preview is stale: close it and review again.
    setSubmitOpen(false);
    setSubmitPreview(null);
    submitCommand.reset();
    setVersion(res.value.version as number);
    setSaved({ reference: String(res.value.reference), id: String(res.value.id) });
    if (isEdit) {
      setPersistedDraft({ modelNumber: modelNumber.trim(), brandId, evidence });
    }
  }

  const draftDirty =
    isEdit &&
    persistedDraft != null &&
    (modelNumber.trim() !== persistedDraft.modelNumber ||
      brandId !== persistedDraft.brandId ||
      evidence.laboratoryCode !== persistedDraft.evidence.laboratoryCode ||
      evidence.testedOn !== persistedDraft.evidence.testedOn ||
      evidence.declaredIseer.trim() !== persistedDraft.evidence.declaredIseer.trim());

  const showSubmitConfirm = submitOpen && !draftDirty;
  const draftErrorDisplay = error ?? draftCommandFailure?.message ?? null;

  async function openSubmitConfirm(appId: string) {
    if (draftDirty) {
      setSubmitError("Save your changes before reviewing submit.");
      return;
    }
    setSubmitError(null);
    submitCommand.reset();
    setPreviewLoading(true);
    const prev = await previewModelApplicationSubmit(appId);
    setPreviewLoading(false);
    if (!prev.ok) {
      setSubmitError(prev.failure.message);
      return;
    }
    setSubmitPreview(prev.preview);
    setSubmitOpen(true);
  }

  async function reloadSubmitContext(appId: string) {
    submitCommand.reset();
    setSubmitError(null);
    if (editId) await reloadDraftFromServer();
    setPreviewLoading(true);
    const prev = await previewModelApplicationSubmit(appId);
    setPreviewLoading(false);
    if (!prev.ok) {
      setSubmitError(prev.failure.message);
      return;
    }
    setSubmitPreview(prev.preview);
    setSubmitOpen(true);
  }

  async function confirmSubmit(appId: string) {
    if (!submitPreview?.submissionFee) return;
    if (draftDirty) {
      setSubmitError("Save your changes before reviewing submit.");
      return;
    }
    setSubmitError(null);
    const res = await submitCommand.execute({
      appId,
      version: submitPreview.version,
      expectedFee: {
        amountInr: submitPreview.submissionFee.amountInr,
        feeRuleKey: submitPreview.submissionFee.feeRuleKey,
        feeRuleVersion: submitPreview.submissionFee.feeRuleVersion,
      },
    });
    if (!res?.ok) return;
    setSubmitOpen(false);
    setSubmitPreview(null);
    setSubmitDone({ reference: res.value.application.reference, id: res.value.application.id, fee: res.value.submissionFee });
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
            The evidence checks passed at submit. They are provisional local defaults, not BEE rules.
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
              disabled={previewLoading || submitBusy}
              className="w-full bg-primary text-on-primary py-2.5 rounded-lg font-label-md disabled:opacity-50"
              data-testid="model-draft-submit"
              onClick={() => openSubmitConfirm(saved.id)}
            >
              {previewLoading ? "Loading…" : "Review submit and provisional fee"}
            </button>
            <Link href={modelDraftFormHref(saved.id)} className="text-center text-primary font-label-md">
              Edit draft first
            </Link>
            <Link href={modelDashboardHref(saved.id)} className="text-center text-on-surface-variant font-label-sm">
              View on dashboard
            </Link>
          </div>
          {showSubmitConfirm && submitPreview ? (
            <SubmitConfirmCard
              preview={submitPreview}
              loading={previewLoading || submitBusy}
              error={submitError}
              commandFailure={submitCommandFailure}
              signInReturnTo={signInReturnTo}
              onReload={() => void reloadSubmitContext(saved.id)}
              onCancel={() => { setSubmitOpen(false); setSubmitError(null); submitCommand.reset(); }}
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
            <Card title="Test evidence">
              <p className="font-label-sm text-label-sm text-on-surface-variant mb-space-sm">
                Required before submit. These checks are provisional local defaults, not BEE rules.
              </p>
              <div className="space-y-space-md">
                <label className="block font-label-sm text-label-sm text-on-surface-variant">
                  Laboratory
                  <select
                    value={evidence.laboratoryCode}
                    onChange={(e) => setEvidence({ ...evidence, laboratoryCode: e.target.value })}
                    className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
                    data-testid="model-draft-laboratory"
                  >
                    <option value="">Select a laboratory</option>
                    {laboratories.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.name} ({l.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block font-label-sm text-label-sm text-on-surface-variant">
                  Test date
                  <input
                    type="date"
                    value={evidence.testedOn}
                    onChange={(e) => setEvidence({ ...evidence, testedOn: e.target.value })}
                    className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
                    data-testid="model-draft-tested-on"
                  />
                </label>
                <label className="block font-label-sm text-label-sm text-on-surface-variant">
                  Declared efficiency (ISEER)
                  <input
                    inputMode="decimal"
                    value={evidence.declaredIseer}
                    onChange={(e) => setEvidence({ ...evidence, declaredIseer: e.target.value })}
                    className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
                    data-testid="model-draft-iseer"
                  />
                </label>
              </div>
            </Card>
            {draftErrorDisplay ? (
              <div data-testid="model-draft-error">
                <p className="text-error font-body-sm">{draftErrorDisplay}</p>
                {draftCommandFailure ? (
                  <CommandFailureFollowUp
                    failure={draftCommandFailure}
                    signInReturnTo={signInReturnTo}
                    onReload={editId ? () => void reloadDraftFromServer() : undefined}
                  />
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              disabled={saveBusy || !modelNumber.trim() || (isEdit && !editId) || (!isEdit && !brandId)}
              onClick={() => void saveDraft()}
              className="w-full bg-primary text-on-primary py-2.5 rounded-lg font-label-md disabled:opacity-50"
              data-testid="model-draft-save"
            >
              {saveBusy ? "Saving…" : isEdit ? "Save changes" : "Save draft"}
            </button>
            {isEdit && activeId ? <DraftTestReports applicationId={activeId} /> : null}
            {isEdit && activeId ? (
              <>
                {draftDirty ? (
                  <p className="text-error font-body-sm" data-testid="model-draft-dirty-hint">
                    Save your changes before reviewing submit.
                  </p>
                ) : null}
                {submitError && !submitOpen ? (
                  <p className="text-error font-body-sm" data-testid="model-submit-error">{submitError}</p>
                ) : null}
                <button
                  type="button"
                  disabled={previewLoading || submitBusy || draftDirty}
                  onClick={() => void openSubmitConfirm(activeId)}
                  className="w-full border border-primary text-primary py-2.5 rounded-lg font-label-md disabled:opacity-50"
                  data-testid="model-draft-submit"
                >
                  {previewLoading && submitOpen ? "Loading…" : "Review submit and provisional fee"}
                </button>
              </>
            ) : null}
            {showSubmitConfirm && submitPreview && activeId ? (
              <SubmitConfirmCard
                preview={submitPreview}
                loading={previewLoading || submitBusy}
                error={submitError}
                commandFailure={submitCommandFailure}
                signInReturnTo={signInReturnTo}
                onReload={() => void reloadSubmitContext(activeId)}
                onCancel={() => { setSubmitOpen(false); setSubmitError(null); submitCommand.reset(); }}
                onConfirm={() => void confirmSubmit(activeId)}
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

function CommandFailureFollowUp({
  failure,
  signInReturnTo,
  onReload,
}: {
  failure: CommandFailure;
  signInReturnTo: string;
  onReload?: () => void;
}) {
  const advice = commandAdvice(failure);
  return (
    <>
      {advice.retryable ? <p className="font-label-sm text-on-surface-variant mt-1">Nothing was lost. You can try again.</p> : null}
      {advice.reload && onReload ? (
        <button type="button" onClick={onReload} className="mt-1 text-primary font-label-md hover:underline">
          Reload the latest version
        </button>
      ) : null}
      {advice.signIn ? (
        <Link href={`/api/auth/login?returnTo=${signInReturnTo}`} className="mt-1 inline-block text-primary font-label-md hover:underline">
          Sign in
        </Link>
      ) : null}
    </>
  );
}

function SubmitConfirmCard({
  preview,
  loading,
  error,
  commandFailure,
  signInReturnTo,
  onReload,
  onCancel,
  onConfirm,
}: {
  preview: SubmitPreview;
  loading: boolean;
  error: string | null;
  commandFailure: CommandFailure | null;
  signInReturnTo: string;
  onReload: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Card title="Confirm submit" data-testid="model-submit-confirm">
      <p className="font-body-sm text-on-surface-variant">{preview.intakeNote}</p>
      <ul className="mt-space-sm space-y-1 font-body-sm" data-testid="model-submit-gates">
        {preview.evidenceGates.map((g) => (
          <li key={g.code} data-testid={`model-submit-gate-${g.code}`} data-met={g.met ? "true" : "false"} className="flex items-center gap-1">
            <Icon name={g.met ? "check_circle" : "cancel"} size={16} className={g.met ? "text-primary" : "text-error"} />
            <span className={g.met ? "" : "text-error"}>{GATE_LABELS[g.code] ?? g.code}</span>
          </li>
        ))}
      </ul>
      {!preview.ready || !preview.submissionFee ? (
        <p className="text-error font-body-sm mt-space-sm">This draft is not ready to submit. Complete the unmet checks above, and check brand authorisation and master rules.</p>
      ) : (
        <div className="mt-space-md space-y-1 font-body-sm">
          {preview.draftSummary ? (
            <p data-testid="model-submit-draft-summary">
              Submitting persisted draft: <span className="font-semibold">{preview.draftSummary.brandName}</span>
              {" · "}
              {preview.draftSummary.category} · model {preview.draftSummary.modelNumber}
            </p>
          ) : null}
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
      {commandFailure ? (
        <div className="mt-space-sm">
          <p className="text-error font-body-sm">{commandFailure.message}</p>
          <CommandFailureFollowUp failure={commandFailure} signInReturnTo={signInReturnTo} onReload={onReload} />
        </div>
      ) : null}
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
