import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { A11yProvider, useA11y } from "@/components/public/A11yProvider";

function A11yProbe() {
  const { scale, contrast } = useA11y();
  return (
    <span data-testid="a11y">
      {scale},{contrast ? "on" : "off"}
    </span>
  );
}

describe("A11yProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("merges a stored value over defaults on first render", () => {
    localStorage.setItem("bee-a11y", JSON.stringify({ scale: 1.2, contrast: true }));
    render(
      <A11yProvider>
        <A11yProbe />
      </A11yProvider>,
    );
    expect(screen.getByTestId("a11y").textContent).toBe("1.2,on");
  });

  it("falls back to defaults when stored JSON is invalid", () => {
    localStorage.setItem("bee-a11y", "{not-json");
    render(
      <A11yProvider>
        <A11yProbe />
      </A11yProvider>,
    );
    expect(screen.getByTestId("a11y").textContent).toBe("1,off");
  });
});
