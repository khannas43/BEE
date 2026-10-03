import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Card } from "@/components/app/ScreenScaffold";
import type { ReadFailure, ReadLike } from "@/lib/client/runtimeHttp";

/**
 * The standard states of a runtime screen: loading, failure (session, forbidden, not found, unavailable),
 * empty, and the rendered result. Every screen uses these, so the wording and the test ids stay the same.
 */

export function LoadingNote({ text, testId }: { text: string; testId?: string }) {
  return (
    <p className="font-body-md text-body-md text-on-surface-variant" data-testid={testId}>
      {text}
    </p>
  );
}

export function FailureBanner({ failure, testId, signInReturnTo }: { failure: ReadFailure; testId: string; signInReturnTo: string }) {
  const icon = failure.kind === "session" ? "login" : failure.kind === "forbidden" ? "lock" : failure.kind === "not_found" ? "search_off" : "error";
  return (
    <div className="flex items-start gap-space-sm" data-testid={testId} data-failure-kind={failure.kind} data-failure-code={"code" in failure ? failure.code : failure.kind}>
      <Icon name={icon} size={20} className="text-error shrink-0 mt-0.5" />
      <div>
        <p className="font-body-md text-body-md text-on-surface">{failure.message}</p>
        {failure.kind === "not_found" ? (
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-1">The same message is shown whether the identifier is unknown or outside your scope.</p>
        ) : null}
        {failure.kind === "session" ? (
          <Link href={`/api/auth/login?returnTo=${signInReturnTo}`} className="inline-flex items-center gap-1 mt-space-sm font-label-md text-label-md text-primary hover:underline">
            Sign in <Icon name="arrow_forward" size={14} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

type Ok<R extends ReadLike> = Extract<R, { ok: true }>;

/**
 * A card that shows the right state for one read: `null` is loading, a failure is the banner, an empty result
 * is the empty note, and anything else is `children(result)`.
 */
export function ReadPanel<R extends ReadLike>({
  title,
  read,
  loadingText,
  loadingTestId,
  errorTestId,
  signInReturnTo,
  isEmpty,
  emptyText,
  emptyTestId,
  action,
  resultAction,
  children,
}: {
  title: string;
  read: R | null;
  loadingText: string;
  loadingTestId?: string;
  errorTestId: string;
  signInReturnTo: string;
  isEmpty?: (result: Ok<R>) => boolean;
  emptyText?: string;
  emptyTestId?: string;
  /** Shown in the card header in every state (for example a Close link). */
  action?: ReactNode;
  /** Shown in the card header only for a loaded result (for example a record count). */
  resultAction?: (result: Ok<R>) => ReactNode;
  children: (result: Ok<R>) => ReactNode;
}) {
  if (!read) {
    return (
      <Card title={title} action={action}>
        <LoadingNote text={loadingText} testId={loadingTestId} />
      </Card>
    );
  }
  if (!read.ok) {
    return (
      <Card title={title} action={action}>
        <FailureBanner failure={read.failure} testId={errorTestId} signInReturnTo={signInReturnTo} />
      </Card>
    );
  }
  const result = read as Ok<R>;
  if (isEmpty?.(result)) {
    return (
      <Card title={title} action={resultAction?.(result) ?? action}>
        <p className="font-body-md text-body-md text-on-surface-variant" data-testid={emptyTestId}>
          {emptyText}
        </p>
      </Card>
    );
  }
  return (
    <Card title={title} action={resultAction?.(result) ?? action}>
      {children(result)}
    </Card>
  );
}

export interface DescriptionRow {
  label: string;
  value: string;
  mono?: boolean;
  capitalize?: boolean;
}

/** Label and value pairs for a record's fields. */
export function DescriptionList({ rows, testId }: { rows: DescriptionRow[]; testId?: string }) {
  return (
    <dl className="space-y-space-sm" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">{row.label}</dt>
          <dd className={`font-body-sm text-body-sm text-on-surface mt-0.5 ${row.mono ? "font-mono break-all" : ""} ${row.capitalize ? "capitalize" : ""}`}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
