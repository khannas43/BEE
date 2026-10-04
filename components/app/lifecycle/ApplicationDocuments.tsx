"use client";

import { useEffect, useState } from "react";
import { documentContentPath, listModelDocuments, type ModelDocument } from "@/lib/client/runtimeModelDocuments";

/**
 * Read-only list of an application's test-report versions with the same download link as the draft form. Shared by the
 * model dashboard and the IAME screen. Spring decides who may read the documents; this only shows what it returned.
 * Key it by application id so a selection change never shows the previous application's reports.
 */
export function ApplicationDocuments({ applicationId }: { applicationId: string }) {
  const [docs, setDocs] = useState<ModelDocument[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listModelDocuments(applicationId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.failure.message);
        return;
      }
      setDocs(res.list.items);
      setNote(res.list.verificationNote);
      setError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  const report = docs.find((d) => d.documentKind === "test_report");
  const versions = report?.versions ?? [];

  if (error) {
    return (
      <p className="font-body-sm text-body-sm text-error" data-testid="model-app-detail-documents-error">
        {error}
      </p>
    );
  }

  return (
    <div data-testid="model-app-detail-documents">
      <p className="font-body-sm text-on-surface-variant" data-testid="model-doc-verification-note">
        {note ?? "Local store only — pending verification. Upload does not claim laboratory accreditation, malware clearance or BEE approval."}
      </p>
      <ul className="mt-space-md space-y-space-sm" data-testid="model-doc-versions">
        {versions.length === 0 ? (
          <li className="font-body-sm text-on-surface-variant">No test report uploaded yet.</li>
        ) : (
          versions.map((v) => (
            <li key={v.id} className="font-body-sm" data-testid={`model-doc-version-${v.versionNumber}`}>
              <span className="font-label-sm">v{v.versionNumber}</span> · {v.reportLabel} · {v.originalFilename} ·{" "}
              <span className="font-mono text-[11px]">{v.contentSha256.slice(0, 12)}…</span> ·{" "}
              <span className="text-on-surface-variant">{v.verificationStatus.replaceAll("_", " ")}</span>
              {" · "}
              <a
                href={documentContentPath(applicationId, report!.id, v.id)}
                className="text-primary"
                data-testid={`model-doc-download-${v.versionNumber}`}
              >
                Download
              </a>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

