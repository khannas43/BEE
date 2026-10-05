import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LangProvider, useLang } from "@/components/i18n/LangProvider";

function LangProbe() {
  const { lang } = useLang();
  return <span data-testid="lang">{lang}</span>;
}

describe("LangProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses a valid stored language on first render", () => {
    localStorage.setItem("bee-lang", "hi");
    render(
      <LangProvider>
        <LangProbe />
      </LangProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("hi");
  });

  it("falls back to English for an invalid stored language", () => {
    localStorage.setItem("bee-lang", "fr");
    render(
      <LangProvider>
        <LangProbe />
      </LangProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("en");
  });
});
