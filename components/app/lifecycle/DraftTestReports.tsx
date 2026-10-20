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
export function DraftTestReports({ applicationId, onCount }: { applicationId: string; onCount?: (n: number) => void }) {
  const [docs, setDocs] = useState<ModelDocument[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const upload = useCommand(runUpload, uploadSignature);

  const apply = useCallback((res: Awaited<ReturnType<typeof listModelDocuments>>) => {
    if (!res.ok) {
      setError(res.failure.message);
      return;
    }
    setDocs(res.list.items);
    setNote(res.list.verificationNote);
    setError(null);
    onCount?.(res.list.items.find((d) => d.documentKind === "test_report")?.versions.length ?? 0);
  }, [onCount]);

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
    setDone(null);
    const result = await upload.execute({ applicationId, file, label: label.trim() });
    if (!result?.ok) return;
    setDone(`Uploaded ${file.name}. It is stored as version ${(report?.versions.length ?? 0) + 1} of the test report.`);
    setLabel("");
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
    await refresh();
  }

  const report = docs.find((d) => d.documentKind === "test_report");
  const versions = report?.versions ?? [];

  return (
    <Card title="Test reports">
      <p className="font-label-sm text-label-sm text-on-surface-variant mb-space-sm" data-testid="model-doc-verification-note">
        {note ?? "Local store only — pending verification. Upload does not claim laboratory accreditation, malware clearance or BEE approval."}
      </p>
      <CommandPanel
        className="space-y-space-md [&_[data-testid=model-doc-upload]]:mt-1 [&_[data-testid=model-doc-upload]]:w-full [&_[data-testid=model-doc-upload]]:rounded-lg [&_[data-testid=model-doc-upload]]:!bg-[#1f3c88] [&_[data-testid=model-doc-upload]]:py-2.5 [&_[data-testid=model-doc-upload]]:font-label-md [&_[data-testid=model-doc-upload]]:!text-white"
        state={upload.state}
        onRun={() => void onUpload()}
        runLabel="Upload test report"
        busyLabel="Uploading…"
        disabled={!fileName || !label.trim()}
        runTestId="model-doc-upload"
        errorTestId="model-doc-error"
        signInReturnTo="/app/model-label/new-model-application"
      >
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          Report label
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 w-full py-2 px-3 rounded-lg bg-white border border-outline-variant font-body-sm"
            placeholder="For example Laboratory test report, 12 March 2026"
            data-testid="model-doc-label"
          />
        </label>
        <label className="block font-label-sm text-label-sm text-on-surface-variant">
          PDF file
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="mt-1 block w-full rounded-lg border border-dashed border-outline-variant bg-white p-3 font-body-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#e7effb] file:px-3 file:py-1.5 file:font-semibold file:text-[#14315E]"
            data-testid="model-doc-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setFileName(f?.name ?? "");
              setDone(null);
              if (f && !label.trim()) setLabel(f.name.replace(/\.pdf$/i, ""));
            }}
          />
          <span className="mt-1 block text-[12px] text-[#64748b]">{fileName ? `Selected: ${fileName}` : "Choose the laboratory report as a PDF."}</span>
        </label>
      </CommandPanel>
      {done ? <p role="status" className="mt-space-sm rounded-lg border border-[#b7e0c6] bg-[#e2f3e8] px-3 py-2 text-[13px] font-semibold text-[#14532d]" data-testid="model-doc-done">{done}</p> : null}
      {error ? (
        <p className="text-error font-body-sm mt-space-sm" data-testid="model-doc-input-error">
          {error}
        </p>
      ) : null}
      <ul className="mt-space-md space-y-2" data-testid="model-doc-versions">
        {versions.length === 0 ? (
          <li className="rounded-lg border border-dashed border-[#dbe6f7] bg-[#f9fbff] px-3 py-2 text-[13px] text-on-surface-variant">No test report uploaded yet.</li>
        ) : (
          versions.map((v) => (
            <li key={v.id} className="rounded-lg border border-[#dbe6f7] bg-[#f9fbff] px-3 py-2 text-[13px]" data-testid={`model-doc-version-${v.versionNumber}`}>
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
