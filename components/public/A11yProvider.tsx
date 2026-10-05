"use client";

import { createContext, startTransition, useContext, useEffect, useState } from "react";

const KEY = "bee-a11y";

interface A11yState {
  scale: number; // 0.9 – 1.4
  contrast: boolean;
  readable: boolean;
}

interface A11yCtx extends A11yState {
  bigger: () => void;
  smaller: () => void;
  toggleContrast: () => void;
  toggleReadable: () => void;
  reset: () => void;
}

const DEFAULT: A11yState = { scale: 1, contrast: false, readable: false };

const Ctx = createContext<A11yCtx>({
  ...DEFAULT,
  bigger: () => {},
  smaller: () => {},
  toggleContrast: () => {},
  toggleReadable: () => {},
  reset: () => {},
});

export function A11yProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<A11yState>(DEFAULT);

  useEffect(() => {
    startTransition(() => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) setState({ ...DEFAULT, ...JSON.parse(raw) });
      } catch {
        /* ignore */
      }
    });
  }, []);

  // Apply effects to the document.
  useEffect(() => {
    const root = document.documentElement;
    try {
      (root.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(state.scale);
    } catch {
      /* ignore */
    }
    root.classList.toggle("a11y-contrast", state.contrast);
    root.classList.toggle("a11y-readable", state.readable);
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state]);

  const clamp = (n: number) => Math.min(1.4, Math.max(0.9, Math.round(n * 100) / 100));

  const value: A11yCtx = {
    ...state,
    bigger: () => setState((s) => ({ ...s, scale: clamp(s.scale + 0.1) })),
    smaller: () => setState((s) => ({ ...s, scale: clamp(s.scale - 0.1) })),
    toggleContrast: () => setState((s) => ({ ...s, contrast: !s.contrast })),
    toggleReadable: () => setState((s) => ({ ...s, readable: !s.readable })),
    reset: () => setState(DEFAULT),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useA11y() {
  return useContext(Ctx);
}
