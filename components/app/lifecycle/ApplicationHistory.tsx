"use client";

import { useEffect, useState } from "react";
import { HISTORY_ACTION_LABELS, type ApplicationHistory as History, readModelHistory } from "@/lib/client/runtimeModelHistory";
import { stateLabel } from "@/lib/client/runtimeModelApplications";

/**
 * Every step of an application from submission on, in order: who took it (an officer sees the name; the applicant sees the
 * role and organisation), when, the stage it left and entered, and the note or reason. Shared by the model dashboard and the
 * officer screens. Spring decides who may read it and what each reader sees; steps with an internal note the reader may not
 * see are marked as withheld. Key it by application id so a selection change never shows another application's history.
 * Provisional local rules, not BEE rules (decision B13).
 */
export const HISTORY_COPY = {
  loading: "Loading the history…",
  empty: "Nothing has happened to this application yet.",
  withheld: "Internal note, not shown to you.",
  applicantNote: "You see every step and the notes addressed to you. The officers' internal notes are not shown.",
  failed: "The history could not be loaded.",
} as const;

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });

export function ApplicationHistory({ applicationId, testIdPrefix = "history" }: { applicationId: string; testIdPrefix?: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readModelHistory(applicationId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.failure.message || HISTORY_COPY.failed);
        return;
      }
      setHistory(res.history);
      setError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (error) {
    return <p className="font-body-sm text-body-sm text-error" data-testid={`${testIdPrefix}-error`}>{error}</p>;
  }
  if (!history) {
    return <p className="font-body-sm text-body-sm text-on-surface-variant" data-testid={`${testIdPrefix}-loading`}>{HISTORY_COPY.loading}</p>;
  }
  if (history.items.length === 0) {
    return <p className="font-body-sm text-body-sm text-on-surface-variant" data-testid={`${testIdPrefix}-empty`}>{HISTORY_COPY.empty}</p>;
  }
  return (
    <div data-testid={testIdPrefix} data-viewed-as={history.viewedAs}>
      {history.viewedAs === "applicant" ? (
        <p className="font-label-sm text-label-sm text-on-surface-variant mb-space-sm" data-testid={`${testIdPrefix}-applicant-note`}>{HISTORY_COPY.applicantNote}</p>
      ) : null}
      <ol className="space-y-space-md" data-testid={`${testIdPrefix}-list`}>
        {history.items.map((e) => (
          <li key={e.sequence} className="border-l-2 border-border-subtle pl-space-md" data-testid={`${testIdPrefix}-step-${e.sequence}`} data-action={e.action}>
            <p className="font-label-md text-label-md text-on-surface">
              {e.sequence}. {HISTORY_ACTION_LABELS[e.action]}
            </p>
            <p className="font-label-sm text-label-sm text-on-surface-variant">
              {stateLabel(e.fromState)} → {stateLabel(e.toState)} · {e.actorName ? `${e.actorName}, ` : ""}{e.actorRole} ({e.actorOrganisation}) · {when(e.at)}
            </p>
            {e.note ? <p className="font-body-sm text-body-sm mt-1" data-testid={`${testIdPrefix}-note-${e.sequence}`}>{e.note}</p> : null}
            {e.facts.length ? (
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-space-sm font-label-sm text-label-sm text-on-surface-variant">
                {e.facts.map((f) => (
                  <div key={f.label} className="contents">
                    <dt>{f.label}</dt>
                    <dd className="text-on-surface">{f.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {e.withheld ? <p className="font-label-sm text-label-sm text-on-surface-variant italic mt-1" data-testid={`${testIdPrefix}-withheld-${e.sequence}`}>{HISTORY_COPY.withheld}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
