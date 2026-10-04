"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/app/ScreenScaffold";
import { CommandPanel, useCommand } from "@/components/app/kit/CommandPanel";
import {
  documentContentPath,
  listModelDocuments,
  uploadModelDocument,
  type ModelDocument,
} from "@/lib/client/runtimeModelDocuments";

type UploadInput = { applicationId: string; file: File; label: string };

// Stable for useCommand: one key per exact payload, so a lost-response retry replays and a different file or label is new.
const runUpload = (p: UploadInput, key: string) => uploadModelDocument(p.applicationId, { file: p.file, reportLabel: p.label }, key);
const uploadSignature = (p: UploadInput) => [p.applicationId, p.file.name, p.file.size, p.file.lastModified, p.label];

/** Contextual test-report intake on the draft form (WP06.1a). Not a top-level menu. */
export function DraftTestReports({ applicationId }: { applicationId: string }) {
  const [docs, setDocs] = useState<ModelDocument[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useCommand(runUpload, uploadSignature);

  const apply = useCallback((res: Awaited<ReturnType<typeof listModelDocuments>>) => {
    if (!res.ok) {
      setError(res.failure.message);
      return;
    }
    setDocs(res.list.items);
    setNote(res.list.verificationNote);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    apply(await listModelDocuments(applicationId));
  }, [applicationId, apply]);

  useEffect(() => {
    let cancelled = false;
    void listModelDocuments(applicationId).then((res) => {
      if (!cancelled) apply(res);
    });
    return () => {
      cancelled = true;
    };
  }, [applicationId, apply]);

  async function onUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !label.trim()) {
      setError("Choose a PDF and enter a report label.");
      return;
    }
    setError(null);
    const result = await upload.execute({ applicationId, file, label: label.trim() });
    if (!result?.ok) return;
    setLabel("");
    if (fileRef.current) fileRef.current.value = "";
    await refresh();
  }

  const report = docs.find((d) => d.documentKind === "test_report");
  const versions = report?.versions ?? [];

  return (
    <Card title="Test reports">
      <p className="font-body-sm text-on-surface-variant" data-testid="model-doc-verification-note">
        {note ?? "Local store only — pending verification. Upload does not claim laboratory accreditation, malware clearance or BEE approval."}
      </p>
      <CommandPanel
        className="mt-space-md space-y-space-sm"
        state={upload.state}
        onRun={() => void onUpload()}
        runLabel="Upload test report"
        busyLabel="Uploading…"
        runTestId="model-doc-upload"
        errorTestId="model-doc-error"
        signInReturnTo="/app/model-label/new-model-application"
      >
        <label className="block font-label-sm text-on-surface-variant">
          Report label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 w-full py-2 px-3 rounded-lg bg-surface-ground font-body-sm"
            data-testid="model-doc-label"
          />
        </label>
        <label className="block font-label-sm text-on-surface-variant">
          PDF file
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="mt-1 w-full font-body-sm"
            data-testid="model-doc-file"
          />
        </label>
      </CommandPanel>
      {error ? (
        <p className="text-error font-body-sm mt-space-sm" data-testid="model-doc-input-error">
          {error}
        </p>
      ) : null}
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
    </Card>
  );
}
