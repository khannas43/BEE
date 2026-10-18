import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/login/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LoginPage sign-in discovery", () => {
  it("does not expose the Keycloak link while checking for demo sign-in", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      finish = resolve;
    })));

    render(<LoginPage />);

    expect(screen.getByRole("status").textContent).toContain("Preparing sign-in");
    expect(screen.queryByRole("link", { name: /Sign in with BEE identity/i })).toBeNull();

    finish(json({ enabled: true }));
    expect(await screen.findByLabelText("Username")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Sign in with BEE identity/i })).toBeNull();
  });

  it("shows the BEE identity link only after a non-demo deployment is confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ enabled: false })));

    render(<LoginPage />);

    await waitFor(() => expect(screen.getByRole("link", { name: /Sign in with BEE identity/i })).toBeTruthy());
  });
});
