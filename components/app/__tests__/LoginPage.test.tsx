import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPageClient } from "@/components/login/LoginPageClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LoginPage sign-in discovery", () => {
  it("renders only credential controls in demo mode", () => {
    render(<LoginPageClient demo />);

    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByTestId("forgot-password-link").getAttribute("href")).toBe("/contact?request=password-reset");
    expect(screen.getByTestId("new-user-registration-link").getAttribute("href")).toBe("/register/manufacturer");
    expect(screen.queryByText("Preparing the available sign-in method…")).toBeNull();
    expect(screen.queryByText("Development preview only")).toBeNull();
    expect(screen.queryByRole("button", { name: /Demo accounts/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Sign in with BEE identity/i })).toBeNull();
  });

  it("keeps the BEE identity action without development preview content in a non-demo deployment", () => {
    render(<LoginPageClient demo={false} />);

    expect(screen.getByRole("link", { name: /Sign in with BEE identity/i })).toBeTruthy();
    expect(screen.queryByText("Development preview only")).toBeNull();
  });
});
