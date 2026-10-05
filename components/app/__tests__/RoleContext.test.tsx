import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ROLE_PREVIEW_ENABLED, RoleProvider, useRole } from "@/components/app/RoleContext";

function RoleProbe() {
  const { role } = useRole();
  return <span data-testid="role">{role}</span>;
}

describe("RoleProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses a stored preview role on first render when preview is enabled", () => {
    if (!ROLE_PREVIEW_ENABLED) return;
    localStorage.setItem("bee-role", "finance");
    render(
      <RoleProvider>
        <RoleProbe />
      </RoleProvider>,
    );
    expect(screen.getByTestId("role").textContent).toBe("finance");
  });

  it("falls back to admin for an unknown stored role", () => {
    if (!ROLE_PREVIEW_ENABLED) return;
    localStorage.setItem("bee-role", "not-a-role");
    render(
      <RoleProvider>
        <RoleProbe />
      </RoleProvider>,
    );
    expect(screen.getByTestId("role").textContent).toBe("admin");
  });
});
