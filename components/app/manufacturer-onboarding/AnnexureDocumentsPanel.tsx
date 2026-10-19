"use client";

import { Icon } from "@/components/ui/Icon";
import { DOCUMENT_KIND_LABELS, type ManufacturerOnboardingDocumentKind } from "@/lib/manufacturer-onboarding/documentKinds";
import { DOCUMENT_KIND_ICONS } from "@/lib/manufacturer-onboarding/documentPresentation";
import type { AnnexureDocument, ManufacturerDraft } from "@/lib/manufacturer-onboarding/types";
import { wizardInputClass } from "./wizardChrome";

const uploadBtnBase =
  "inline-flex h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-label-sm font-semibold cursor-pointer whitespace-nowrap";

type Props = {
  draft: ManufacturerDraft;
  busy: boolean;
  onNotesChange: (documentKind: string, value: string) => void;
  onUpload: (documentKind: ManufacturerOnboardingDocumentKind, file: File) => void;
  onRemove: (documentKind: ManufacturerOnboardingDocumentKind) => void;
};

function requiredKindLabel(kind: ManufacturerOnboardingDocumentKind): string {
  return DOCUMENT_KIND_LABELS[kind];
}

export function AnnexureDocumentsPanel({ draft, busy, onNotesChange, onUpload, onRemove }: Props) {
  return (
    <ul className="space-y-2" data-testid="annexure-document-list">
      {draft.annexureDocuments.map((doc) => (
        <AnnexureDocumentRow
          key={doc.id}
          doc={doc}
          busy={busy}
          note={draft.annexureNotes[doc.id] ?? ""}
          onNotesChange={(v) => onNotesChange(doc.id, v)}
          onUpload={(file) => onUpload(doc.id as ManufacturerOnboardingDocumentKind, file)}
          onRemove={() => onRemove(doc.id as ManufacturerOnboardingDocumentKind)}
        />
      ))}
    </ul>
  );
}

function AnnexureDocumentRow({
  doc,
  note,
  busy,
  onNotesChange,
  onUpload,
  onRemove,
}: {
  doc: AnnexureDocument;
  note: string;
  busy: boolean;
  onNotesChange: (value: string) => void;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const kind = doc.id as ManufacturerOnboardingDocumentKind;
  const icon = DOCUMENT_KIND_ICONS[kind] ?? "attach_file";
  const uploaded = Boolean(doc.uploadedAt);
  const requiredTitle = requiredKindLabel(kind);

  return (
    <li
      className={`rounded-lg border px-3 py-2.5 transition-shadow ${
        uploaded ? "border-success/30 bg-success-container/10" : "border-border-subtle bg-surface-container-lowest"
      }`}
      data-testid={`annexure-row-${doc.id}`}
    >
      <div className="flex gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            uploaded ? "bg-success/15 text-success" : "bg-primary/10 text-primary"
          }`}
        >
          <Icon name={uploaded ? "task" : icon} size={20} />
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-on-surface">{requiredTitle}</p>
            {uploaded ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/15 text-success px-2 py-0.5 text-xs font-label-sm" data-testid={`upload-status-${doc.id}`}>
                <Icon name="check_circle" size={14} />
                Uploaded
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high text-on-surface-variant px-2 py-0.5 text-xs font-label-sm" data-testid={`upload-status-${doc.id}`}>
                Required
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end gap-2 w-full">
            <label className="block flex-1 min-w-0 sm:mb-0">
              <span className="text-xs font-label-sm text-on-surface-variant">Document name / reference</span>
              <input
                className={wizardInputClass}
                value={note}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder={`e.g. ${requiredTitle} — FY 2025-26`}
                data-testid={`annexure-label-${doc.id}`}
              />
            </label>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
              <label
                className={`${uploadBtnBase} border border-dashed border-primary/50 bg-primary/5 text-primary hover:bg-primary/10 ${
                  busy ? "opacity-50 pointer-events-none" : ""
                }`}
              >
                <Icon name="upload_file" size={18} />
                {uploaded ? "Replace" : "Upload file"}
                <input
                  type="file"
                  className="sr-only"
                  accept=".pdf,image/*"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUpload(file);
                    e.target.value = "";
                  }}
                  data-testid={`upload-${doc.id}`}
                />
              </label>
              {uploaded && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onRemove}
                  className={`${uploadBtnBase} border border-error/40 text-error hover:bg-error-container/30 disabled:opacity-40`}
                  data-testid={`remove-${doc.id}`}
                >
                  <Icon name="delete" size={16} />
                  Remove
                </button>
              )}
            </div>
          </div>

          {uploaded && (
            <p className="text-xs text-on-surface-variant flex items-center gap-1.5 truncate">
              <Icon name="description" size={16} className="shrink-0" />
              <span className="truncate" title={doc.fileName}>
                {doc.fileName}
              </span>
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
