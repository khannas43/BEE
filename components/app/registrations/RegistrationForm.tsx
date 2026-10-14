"use client";

import { useEffect, useState } from "react";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import { FailureBanner, LoadingNote } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { BRAND_NAME, BRAND_NAME_RULE } from "@/components/app/registrations/labels";
import {
  type Registration,
  type RegistrationWrite,
  type SaveRegistrationInput,
  readEligibleBrands,
  runSaveRegistration,
  saveRegistrationSignature,
} from "@/lib/client/runtimeRegistrations";

const loadBrands = () => readEligibleBrands();
const field = "mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm";

export function RegistrationForm({
  kind,
  today,
  existing,
  signInReturnTo,
  onSaved,
  onDirtyChange,
}: {
  kind: "brand" | "agency";
  today: string;
  existing?: Registration | null;
  signInReturnTo: string;
  onSaved: (registration: Registration) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const revalidation = useRevalidation();
  const brands = useRuntimeRead(kind === "agency" ? "brands" : null, loadBrands, revalidation);
  const [brandName, setBrandName] = useState(existing?.brandName ?? "");
  const [brandId, setBrandId] = useState(existing?.brandId ?? "");
  const [validFrom, setValidFrom] = useState(existing?.validFrom ?? (kind === "agency" ? today : ""));
  const [validTo, setValidTo] = useState(existing?.validTo ?? "");
  const [saved, setSaved] = useState({ brandName: existing?.brandName ?? "", brandId: existing?.brandId ?? "", validFrom: existing?.validFrom ?? (kind === "agency" ? today : ""), validTo: existing?.validTo ?? "" });
  const [inputError, setInputError] = useState<string | null>(null);
  const command = useCommand(runSaveRegistration, saveRegistrationSignature);
  const dirty = brandName !== saved.brandName || brandId !== saved.brandId || validFrom !== saved.validFrom || validTo !== saved.validTo;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  async function save() {
    const name = brandName.trim();
    let write: RegistrationWrite;
    if (kind === "brand") {
      if (!BRAND_NAME.test(name)) {
        setInputError(BRAND_NAME_RULE);
        return;
      }
      write = { kind: "brand", brandName: name };
    } else {
      if (!brandId || !/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || validFrom < today || (validTo !== "" && validTo <= validFrom)) {
        setInputError("Choose a brand, a start date from today, and an end date after the start if you set one.");
        return;
      }
      write = validTo ? { kind: "agency", brandId, validFrom, validTo } : { kind: "agency", brandId, validFrom };
    }
    setInputError(null);
    const payload: SaveRegistrationInput = existing ? { ...write, id: existing.id, version: existing.version } : write;
    const result = await command.execute(payload);
    if (result?.ok) {
      setBrandName(name);
      setSaved({ brandName: name, brandId, validFrom, validTo });
      onSaved(result.value);
    }
  }

  return (
    <section className="bg-surface-card rounded-xl shadow-sm p-space-md" data-testid="reg-form">
      <h2 className="font-title-md text-title-md text-on-surface">{kind === "brand" ? "Register a brand" : "Ask to act for a brand"}</h2>
      {kind === "agency" && brands === null ? <LoadingNote text="Loading brands…" testId="reg-brands-loading" /> : null}
      {kind === "agency" && brands && !brands.ok ? <FailureBanner failure={brands.failure} testId="reg-brands-error" signInReturnTo={signInReturnTo} /> : null}
      {kind === "agency" && brands && brands.ok && brands.brands.items.length === 0 ? (
        <p className="font-body-sm text-on-surface-variant mt-space-sm" data-testid="reg-brands-empty">No brand is available to act for.</p>
      ) : null}
      <CommandPanel
        className="mt-space-sm space-y-space-sm"
        state={command.state}
        onRun={() => void save()}
        runLabel={existing ? "Save changes" : "Save draft"}
        busyLabel="Saving…"
        runTestId="reg-save"
        errorTestId="reg-save-error"
        reloadTestId="reg-save-reload"
        onReload={revalidation.refresh}
        signInReturnTo={signInReturnTo}
      >
        {kind === "brand" ? (
          <label className="block font-label-sm text-label-sm text-on-surface-variant">
            Brand name
            <input value={brandName} onChange={(e) => setBrandName(e.target.value)} maxLength={120} className={field} data-testid="reg-brand-name" />
            <span className="block mt-1" data-testid="reg-brand-rule">{BRAND_NAME_RULE}</span>
          </label>
        ) : (
          <>
            <label className="block font-label-sm text-label-sm text-on-surface-variant">
              Brand
              <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={field} data-testid="reg-brand-choice">
                <option value="">Choose a brand</option>
                {brands && brands.ok
                  ? brands.brands.items.map((b) => (
                      <option key={b.brandId} value={b.brandId}>{b.brandName} · {b.principalOrganisation}</option>
                    ))
                  : null}
              </select>
            </label>
            <label className="block font-label-sm text-label-sm text-on-surface-variant">
              Starts on
              <input type="date" min={today} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={field} data-testid="reg-valid-from" />
            </label>
            <label className="block font-label-sm text-label-sm text-on-surface-variant">
              Ends on (optional)
              <input type="date" min={validFrom || today} value={validTo} onChange={(e) => setValidTo(e.target.value)} className={field} data-testid="reg-valid-to" />
            </label>
          </>
        )}
      </CommandPanel>
      {inputError ? <p className="text-error font-body-sm mt-space-sm" data-testid="reg-form-input-error">{inputError}</p> : null}
      {dirty ? <p className="font-body-sm text-on-surface-variant mt-space-sm" data-testid="reg-dirty">Save your changes before reviewing submit.</p> : null}
    </section>
  );
}
