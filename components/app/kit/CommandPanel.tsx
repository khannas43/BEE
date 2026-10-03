"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { commandAdvice, type CommandFailure, type CommandResult, keepKeyAfter, PayloadKeyGate } from "@/lib/client/runtimeHttp";

/**
 * A command (write) from a screen: one Idempotency-Key per exact payload, a single run at a time, and the outcome as
 * state. A lost response is retried with the same key so the server replays instead of repeating; a definite answer
 * (success or a refusal) starts the next send as a new command (see keepKeyAfter).
 */
export type CommandState<T> =
  | { phase: "idle" }
  | { phase: "busy" }
  | { phase: "done"; value: T; replayed: boolean }
  | { phase: "failed"; failure: CommandFailure };

/**
 * `run` and `signature` MUST be stable (module-level or from useCallback): they are dependencies of `execute`.
 * `signature` returns a JSON-serialisable description of the payload; the same signature reuses the key.
 */
export function useCommand<P, T>(
  run: (payload: P, idempotencyKey: string) => Promise<CommandResult<T>>,
  signature: (payload: P) => unknown,
) {
  const gate = useRef(new PayloadKeyGate());
  const running = useRef(false);
  const [state, setState] = useState<CommandState<T>>({ phase: "idle" });

  const execute = useCallback(
    async (payload: P): Promise<CommandResult<T> | null> => {
      if (running.current) return null;
      running.current = true;
      setState({ phase: "busy" });
      try {
        const result = await run(payload, gate.current.keyFor(signature(payload)));
        if (!keepKeyAfter(result)) gate.current.clear();
        setState(result.ok ? { phase: "done", value: result.value, replayed: result.replayed } : { phase: "failed", failure: result.failure });
        return result;
      } finally {
        running.current = false;
      }
    },
    [run, signature],
  );

  const reset = useCallback(() => {
    gate.current.clear();
    setState({ phase: "idle" });
  }, []);

  return { state, execute, reset };
}

/**
 * The run button, the failure line and the follow-up actions for one command. The inputs are the children.
 * Test ids are passed in so each screen keeps its own stable ids.
 */
export function CommandPanel<T>({
  state,
  onRun,
  runLabel,
  busyLabel,
  runTestId,
  errorTestId,
  disabled,
  onReload,
  reloadTestId,
  signInReturnTo,
  className,
  children,
}: {
  state: CommandState<T>;
  onRun: () => void;
  runLabel: string;
  busyLabel: string;
  runTestId: string;
  errorTestId: string;
  disabled?: boolean;
  /** Re-read the record; offered when the failure says it changed since it was read. */
  onReload?: () => void;
  reloadTestId?: string;
  signInReturnTo?: string;
  className?: string;
  children?: ReactNode;
}) {
  const busy = state.phase === "busy";
  const failure = state.phase === "failed" ? state.failure : null;
  const advice = failure ? commandAdvice(failure) : null;
  return (
    <div className={className}>
      {children}
      {failure ? (
        <div className="mt-space-sm" data-testid={errorTestId} data-failure-kind={failure.kind} data-failure-code={"code" in failure ? failure.code : failure.kind}>
          <p className="text-error font-body-sm">{failure.message}</p>
          {advice?.retryable ? <p className="font-label-sm text-on-surface-variant mt-1">Nothing was lost. You can try again.</p> : null}
          {advice?.reload && onReload ? (
            <button type="button" onClick={onReload} className="mt-1 text-primary font-label-md hover:underline" data-testid={reloadTestId}>
              Reload the latest version
            </button>
          ) : null}
          {advice?.signIn && signInReturnTo ? (
            <Link href={`/api/auth/login?returnTo=${signInReturnTo}`} className="mt-1 inline-block text-primary font-label-md hover:underline">
              Sign in
            </Link>
          ) : null}
        </div>
      ) : null}
      <button
        type="button"
        disabled={busy || disabled}
        onClick={onRun}
        className="mt-space-sm w-full border border-primary text-primary py-2.5 rounded-lg font-label-md disabled:opacity-50"
        data-testid={runTestId}
      >
        {busy ? busyLabel : runLabel}
      </button>
    </div>
  );
}
