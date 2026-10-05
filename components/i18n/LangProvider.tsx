"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useStoredValue, writeStoredValue } from "@/lib/client/useStoredValue";
import { Lang, translate } from "@/lib/i18n";

const KEY = "bee-lang";

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

export function LangProvider({ children }: { children: React.ReactNode }) {
  const stored = useStoredValue(KEY);
  const lang = useMemo(() => langFromStored(stored), [stored]);

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
