"use client";

import { useSyncExternalStore } from "react";

let epoch = 0;
const listeners = new Set<() => void>();

/** Tell the bell and the notifications page to re-read the list without a full reload. */
export function refreshNotifications() {
  epoch += 1;
  listeners.forEach((listener) => listener());
}

export function useNotificationRefreshEpoch(): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => epoch,
    () => 0,
  );
}
