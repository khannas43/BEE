"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useStoredValue, writeStoredValue } from "@/lib/client/useStoredValue";
import { Lang, translate } from "@/lib/i18n";

const KEY = "bee-lang";

/**
 * Whether the portal offers a language switch. The RFP asks for English only, so it is off: no button is shown and a language stored in the browser
 * earlier is ignored. The Hindi strings stay in lib/i18n.ts; set this to true to bring the switch back.
 */
export const LANGUAGE_SWITCH_ENABLED = false;

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: string) => string;
}

const Ctx = createContext<LangCtx>({
  lang: "en",
  setLang: () => {},
  toggle: () => {},
  t: (k) => translate(k, "en"),
});

function langFromStored(stored: string | null): Lang {
  return stored === "hi" || stored === "en" ? stored : "en";
}

export function LangProvider({ children, switchable = LANGUAGE_SWITCH_ENABLED }: { children: React.ReactNode; switchable?: boolean }) {
  const stored = useStoredValue(KEY);
  const lang = useMemo(() => (switchable ? langFromStored(stored) : "en"), [stored, switchable]);

  const setLang = useCallback((l: Lang) => {
    writeStoredValue(KEY, l);
    try {
      document.documentElement.lang = l;
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = useCallback(() => setLang(lang === "en" ? "hi" : "en"), [lang, setLang]);
  const t = useCallback((key: string) => translate(key, lang), [lang]);

  return <Ctx.Provider value={{ lang, setLang, toggle, t }}>{children}</Ctx.Provider>;
}

export function useLang() {
  return useContext(Ctx);
}
