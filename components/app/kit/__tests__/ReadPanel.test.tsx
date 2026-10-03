import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import type { ReadFailure } from "@/lib/client/runtimeHttp";

type ItemRead = { ok: true; label: string } | { ok: false; failure: ReadFailure };

const RETURN_TO = "/app/models";

function panel(read: ItemRead | null, extras?: { action?: ReactNode; resultAction?: boolean }) {
  cleanup();
  return render(
    <ReadPanel
      title="Applications"
      read={read}
      loadingText="Loading applications"
      loadingTestId="panel-loading"
      errorTestId="panel-error"
      signInReturnTo={RETURN_TO}
      isEmpty={(result) => result.label === ""}
      emptyText="No applications yet"
      emptyTestId="panel-empty"
      action={extras?.action}
      resultAction={extras?.resultAction ? (result) => <span data-testid="result-action">{result.label || "0"} records</span> : undefined}
    >
      {(result) => <p data-testid="panel-result">{result.label}</p>}
    </ReadPanel>,
  );
}

const headerAction = <button type="button" data-testid="header-action">Close</button>;

describe("ReadPanel", () => {
  it("shows loading, then each failure, including the sign-in link for a session failure", () => {
    panel(null, { action: headerAction });
    expect(screen.getByTestId("panel-loading").textContent).toBe("Loading applications");
    expect(screen.getByRole("heading", { name: "Applications" })).toBeTruthy();
    expect(screen.getByTestId("header-action")).toBeTruthy();
    expect(screen.queryByTestId("panel-result")).toBeNull();

    const failures: ReadFailure[] = [
      { kind: "session", code: "no_session", message: "Sign in to continue." },
      { kind: "forbidden", code: "no_read_scope", message: "This role has no read access to model applications." },
      { kind: "not_found", message: "No such record is available to you." },
      { kind: "unavailable", message: "The BEE service is not reachable. Try again later." },
    ];
    for (const failure of failures) {
      panel({ ok: false, failure }, { action: headerAction });
      const banner = screen.getByTestId("panel-error");
      expect(banner.getAttribute("data-failure-kind")).toBe(failure.kind);
      expect(banner.getAttribute("data-failure-code")).toBe("code" in failure ? failure.code : failure.kind);
      expect(banner.textContent).toContain(failure.message);
      expect(screen.getByTestId("header-action")).toBeTruthy();
      expect(screen.queryByTestId("panel-loading")).toBeNull();
      expect(screen.queryByTestId("result-action")).toBeNull();
      if (failure.kind === "session") {
        const link = screen.getByRole("link", { name: "Sign in" });
        expect(link.getAttribute("href")).toBe(`/api/auth/login?returnTo=${RETURN_TO}`);
      } else {
        expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
      }
      if (failure.kind === "not_found") {
        expect(banner.textContent).toContain("The same message is shown whether the identifier is unknown or outside your scope.");
      }
    }
  });

  it("shows the empty note and the result", () => {
    panel({ ok: true, label: "" }, { action: headerAction });
    expect(screen.getByTestId("panel-empty").textContent).toBe("No applications yet");
    expect(screen.getByTestId("header-action")).toBeTruthy();
    expect(screen.queryByTestId("panel-result")).toBeNull();

    panel({ ok: true, label: "AC-1" }, { action: headerAction });
    expect(screen.getByTestId("panel-result").textContent).toBe("AC-1");
    expect(screen.getByTestId("header-action")).toBeTruthy();
    expect(screen.queryByTestId("panel-empty")).toBeNull();
  });

  it("shows the header action in every state and the result action only when loaded", () => {
    panel(null, { action: headerAction, resultAction: true });
    expect(screen.getByTestId("header-action")).toBeTruthy();
    expect(screen.queryByTestId("result-action")).toBeNull();

    panel({ ok: false, failure: { kind: "unavailable", message: "Try again later." } }, { action: headerAction, resultAction: true });
    expect(screen.getByTestId("header-action")).toBeTruthy();
    expect(screen.queryByTestId("result-action")).toBeNull();

    // Loaded states use one header slot: the result action takes it, including an empty result.
    panel({ ok: true, label: "" }, { action: headerAction, resultAction: true });
    expect(screen.getByTestId("result-action").textContent).toBe("0 records");
    expect(screen.queryByTestId("header-action")).toBeNull();

    panel({ ok: true, label: "AC-1" }, { action: headerAction, resultAction: true });
    expect(screen.getByTestId("result-action").textContent).toBe("AC-1 records");
    expect(screen.getByTestId("panel-result").textContent).toBe("AC-1");
    expect(screen.queryByTestId("header-action")).toBeNull();
  });
});
