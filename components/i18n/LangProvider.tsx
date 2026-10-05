"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useState } from "react";
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

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    startTransition(() => {
      try {
        const saved = localStorage.getItem(KEY) as Lang | null;
        if (saved === "hi" || saved === "en") setLangState(saved);
      } catch {
        /* ignore */
      }
    });
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(KEY, l);
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
