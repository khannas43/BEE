"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { useNotificationRefreshEpoch } from "@/lib/client/notificationRefresh";
import { readNotifications } from "@/lib/client/runtimeNotifications";

const PAGE = "/app/model-label/notifications";
const loadBell = () => readNotifications();

export function NotificationBell() {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const notifyEpoch = useNotificationRefreshEpoch();
  const read = useRuntimeRead(
    identity.status === "signed-in" ? `bell-${notifyEpoch}` : null,
    loadBell,
    revalidation,
  );

  if (identity.status !== "signed-in") return null;

  const unread = read?.ok ? read.list.unread : 0;
  const badge = unread > 9 ? "9+" : unread > 0 ? String(unread) : null;
  const aria = badge ? `Notifications, ${unread} unread` : "Notifications";

  return (
    <Link
      href={PAGE}
      className="relative text-on-surface-variant hover:text-on-surface"
      aria-label={aria}
      data-testid="notification-bell"
    >
      <Icon name="notifications" size={22} />
      {badge ? (
        <span
          className="absolute -top-1 -right-1 min-w-4 h-4 px-0.5 bg-error text-on-error rounded-full text-[10px] font-bold flex items-center justify-center"
          data-testid="notification-bell-badge"
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}
