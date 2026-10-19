import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DemoLoginForm } from "@/components/login/DemoLoginForm";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fill(user: string, pass: string) {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: user } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: pass } });
}

describe("DemoLoginForm", () => {
  it("signs in with a username and password and goes where the server says", async () => {
    const seen: { url: string; body: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, body: String(init?.body) });
      return json({ ok: true, returnTo: "/app" });
    }));
    const onSignedIn = vi.fn();
    render(<DemoLoginForm onSignedIn={onSignedIn} />);
    expect(screen.getByRole("button", { name: "Sign in" }).hasAttribute("disabled")).toBe(true);
    fill("bee.director", "demo123");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith("/app"));
    expect(seen[0].url).toBe("/api/runtime/demo/login");
    expect(JSON.parse(seen[0].body)).toEqual({ username: "bee.director", password: "demo123" });
  });

  it("shows a wrong password as an alert and clears the password", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "invalid_credentials" }, 401)));
    const onSignedIn = vi.fn();
    render(<DemoLoginForm onSignedIn={onSignedIn} />);
    fill("bee.director", "nope");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("username or password is not correct");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("shows an unreachable service as an alert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    render(<DemoLoginForm onSignedIn={vi.fn()} />);
    fill("bee.finance", "demo123");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("not reachable");
  });

  it("shows and hides the password, and a demo account chip fills the username only", () => {
    render(<DemoLoginForm onSignedIn={vi.fn()} />);
    const pw = screen.getByLabelText("Password") as HTMLInputElement;
    expect(pw.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(pw.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: /Demo accounts/ }));
    expect(screen.getByText("demo123")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /bee\.officer/ }));
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("bee.officer");
    expect(pw.value).toBe("");
  });
});
