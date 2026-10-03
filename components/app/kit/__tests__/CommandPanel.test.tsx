import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPanel, type CommandState } from "@/components/app/kit/CommandPanel";
import type { CommandFailure } from "@/lib/client/runtimeHttp";

const RETRY = "Nothing was lost. You can try again.";

function panel(state: CommandState<{ id: string }>, extras?: { disabled?: boolean; onReload?: () => void; onRun?: () => void }) {
  cleanup();
  return render(
    <CommandPanel
      state={state}
      onRun={extras?.onRun ?? (() => {})}
      runLabel="Confirm fee"
      busyLabel="Confirming…"
      runTestId="cmd-run"
      errorTestId="cmd-error"
      disabled={extras?.disabled}
      onReload={extras?.onReload}
      reloadTestId="cmd-reload"
      signInReturnTo="/app/finance"
    >
      <p data-testid="cmd-fields">Amount</p>
    </CommandPanel>,
  );
}

describe("CommandPanel", () => {
  it("shows the busy label and disables the button while a command is running", async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    panel({ phase: "busy" }, { onRun });
    const button = screen.getByTestId("cmd-run");
    expect(button.textContent).toBe("Confirming…");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("cmd-fields").textContent).toBe("Amount");
    await user.click(button);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("runs from an idle button and stays disabled when the caller disables it", async () => {
    const onRun = vi.fn();
    const user = userEvent.setup();
    panel({ phase: "idle" }, { onRun });
    const button = screen.getByTestId("cmd-run");
    expect(button.textContent).toBe("Confirm fee");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await user.click(button);
    expect(onRun).toHaveBeenCalledTimes(1);

    panel({ phase: "idle" }, { disabled: true, onRun });
    expect((screen.getByTestId("cmd-run") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the failure line, the reload button only for version_conflict, and the retry line only when retryable", async () => {
    const user = userEvent.setup();
    const cases: { failure: CommandFailure; retryable: boolean; reload: boolean; code: string; signIn?: boolean }[] = [
      { failure: { kind: "unavailable", message: "The service is temporarily unavailable. Try again later." }, retryable: true, reload: false, code: "unavailable" },
      {
        failure: { kind: "conflict", code: "idempotency_in_progress", message: "A request with this Idempotency-Key is still in progress." },
        retryable: true,
        reload: false,
        code: "idempotency_in_progress",
      },
      {
        failure: { kind: "conflict", code: "version_conflict", message: "The record has changed since it was loaded." },
        retryable: false,
        reload: true,
        code: "version_conflict",
      },
      {
        failure: { kind: "validation", code: "validation_failed", message: "The request could not be accepted." },
        retryable: false,
        reload: false,
        code: "validation_failed",
      },
      { failure: { kind: "session", message: "Sign in to continue." }, retryable: false, reload: false, code: "session", signIn: true },
      { failure: { kind: "denied", message: "This request is not permitted." }, retryable: false, reload: false, code: "denied" },
      { failure: { kind: "not_found", message: "No such record is available to you." }, retryable: false, reload: false, code: "not_found" },
    ];

    for (const entry of cases) {
      const onReload = vi.fn();
      panel({ phase: "failed", failure: entry.failure }, { onReload });
      const line = screen.getByTestId("cmd-error");
      expect(line.getAttribute("data-failure-kind")).toBe(entry.failure.kind);
      expect(line.getAttribute("data-failure-code")).toBe(entry.code);
      expect(line.textContent).toContain(entry.failure.message);
      if (entry.retryable) expect(line.textContent).toContain(RETRY);
      else expect(line.textContent).not.toContain(RETRY);
      if (entry.reload) {
        await user.click(screen.getByTestId("cmd-reload"));
        expect(onReload).toHaveBeenCalledTimes(1);
      } else {
        expect(screen.queryByTestId("cmd-reload")).toBeNull();
      }
      if (entry.signIn) {
        expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/api/auth/login?returnTo=/app/finance");
      }
      expect((screen.getByTestId("cmd-run") as HTMLButtonElement).disabled).toBe(false);
    }

    panel(
      { phase: "failed", failure: { kind: "conflict", code: "version_conflict", message: "The record has changed since it was loaded." } },
    );
    expect(screen.queryByTestId("cmd-reload")).toBeNull();
  });
});
