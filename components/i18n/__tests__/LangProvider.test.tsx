import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LANGUAGE_SWITCH_ENABLED, LangProvider, useLang } from "@/components/i18n/LangProvider";

function LangProbe() {
  const { lang } = useLang();
  return <span data-testid="lang">{lang}</span>;
}

describe("LangProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is English only while the RFP asks for it: the switch is off and a stored language is ignored", () => {
    expect(LANGUAGE_SWITCH_ENABLED).toBe(false);
    localStorage.setItem("bee-lang", "hi");
    render(
      <LangProvider>
        <LangProbe />
      </LangProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("en");
  });

  it("uses a valid stored language on first render when the switch is on", () => {
    localStorage.setItem("bee-lang", "hi");
    render(
      <LangProvider switchable>
        <LangProbe />
      </LangProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("hi");
  });

  it("falls back to English for an invalid stored language", () => {
    localStorage.setItem("bee-lang", "fr");
    render(
      <LangProvider switchable>
        <LangProbe />
      </LangProvider>,
    );
    expect(screen.getByTestId("lang").textContent).toBe("en");
  });
});
