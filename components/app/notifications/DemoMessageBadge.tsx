"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { demoGet, demoPath } from "@/lib/client/runtimeDemo";

/** Unread simulated email and SMS, beside the in-portal bell. Hidden unless the messages call succeeds. */
const POLL_MS = 10000;

export function DemoMessageBadge() {
  const [unread, setUnread] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    void demoGet<{ unread: number }>(demoPath("messages")).then((r) => {
      if (!live) return;
      setUnread(r.ok && typeof r.value.unread === "number" ? r.value.unread : null);
    });
    return () => {
      live = false;
    };
  }, [tick]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") reload(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  if (unread === null) return null;

  const pill = unread > 9 ? "9+" : unread > 0 ? String(unread) : null;
  const label = unread > 0
    ? `Simulated email and SMS messages, ${unread} unread`
    : "Simulated email and SMS messages, none unread";

  return (
    <Link href="/app/demo/notifications" className="relative text-on-surface-variant hover:text-on-surface" aria-label={label} data-testid="demo-message-badge">
      <Icon name="mail" size={22} />
      {pill ? (
        <span className="absolute -top-1 -right-1 min-w-4 h-4 px-0.5 bg-primary text-on-primary rounded-full text-[10px] font-bold flex items-center justify-center" data-testid="demo-message-badge-count">
          {pill}
        </span>
      ) : null}
    </Link>
  );
}
