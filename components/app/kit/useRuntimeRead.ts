"use client";

import { useEffect, useState } from "react";
import { refreshIdentity } from "@/components/app/SessionBadge";
import type { ReadLike } from "@/lib/client/runtimeHttp";

export const REVALIDATE_MS = 30_000;

export interface Revalidation {
  /** Bumps on focus, when the tab becomes visible, on a back-forward-cache restore and on the interval. */
  epoch: number;
  /** Bumps only on a back-forward-cache restore: records shown before it must not be shown again. */
  restores: number;
}

/**
 * One revalidation clock per screen. The Spring identity is re-read on every tick, so a sign-out elsewhere,
 * an expiry or a revoked role replaces what is on screen instead of leaving stale records visible.
 */
export function useRevalidation(intervalMs: number = REVALIDATE_MS): Revalidation {
  const [state, setState] = useState<Revalidation>({ epoch: 0, restores: 0 });
  useEffect(() => {
    const tick = (restored: boolean) => {
      const visible = document.visibilityState === "visible";
      if (visible) refreshIdentity();
      if (!visible && !restored) return;
      setState((s) => ({ epoch: s.epoch + (visible ? 1 : 0), restores: s.restores + (restored ? 1 : 0) }));
    };
    const onFocus = () => tick(false);
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) tick(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("pageshow", onPageShow);
    const timer = window.setInterval(onFocus, intervalMs);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.clearInterval(timer);
    };
  }, [intervalMs]);
  return state;
}

/**
 * Reads one target through the BFF and re-reads it on every revalidation tick.
 *
 * - Returns `null` while loading, including right after the target changes or the page is restored from the
 *   back-forward cache, so a previous target's records are never shown for a new one.
 * - `load` MUST be a stable function (a module-level function or one from `useCallback`), because it is an
 *   effect dependency. An inline arrow would re-read on every render.
 * - `target` is only a key passed back to `load`: an id, or any constant for a list. Pass `null` to read nothing.
 * - Wrap the result in `gateRead` so a signed-out identity never shows records.
 */
export function useRuntimeRead<R extends ReadLike>(
  target: string | null,
  load: (target: string) => Promise<R>,
  revalidation: Revalidation,
): R | null {
  const key = target === null ? null : `${revalidation.restores}:${target}`;
  const [state, setState] = useState<{ key: string; read: R } | null>(null);
  useEffect(() => {
    if (key === null || target === null) return;
    let live = true;
    load(target).then((read) => {
      if (live) setState({ key, read });
    });
    return () => {
      live = false;
    };
  }, [key, target, load, revalidation.epoch]);
  return key !== null && state?.key === key ? state.read : null;
}
