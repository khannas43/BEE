"use client";

import { useCallback, useSyncExternalStore } from "react";

const sameTabListeners = new Map<string, Set<() => void>>();

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribeStored(key: string, onStoreChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  let listeners = sameTabListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    sameTabListeners.set(key, listeners);
  }
  listeners.add(onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    listeners!.delete(onStoreChange);
    if (listeners!.size === 0) sameTabListeners.delete(key);
  };
}

/** Notify subscribers in this tab after a write (the `storage` event does not fire in the same document). */
export function notifyStoredValueChange(key: string) {
  sameTabListeners.get(key)?.forEach((listener) => listener());
}

/** Persist a string and re-read subscribers in this tab. Storage access is wrapped in try/catch. */
export function writeStoredValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    notifyStoredValueChange(key);
  } catch {
    /* ignore */
  }
}

/** Read a string from `localStorage` via `useSyncExternalStore` (`null` on the server or when missing/blocked). */
export function useStoredValue(key: string): string | null {
  const subscribe = useCallback((onStoreChange: () => void) => subscribeStored(key, onStoreChange), [key]);
  const getSnapshot = useCallback(() => readStored(key), [key]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** False on the server and during hydration; true once the client store is active. */
export function useClientStorageReady(): boolean {
  return useSyncExternalStore(() => () => {}, () => true, () => false);
}
