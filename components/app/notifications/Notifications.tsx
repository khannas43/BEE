"use client";

import Link from "next/link";
import { ScreenChrome } from "@/components/app/ScreenScaffold";
import { IdentityStrip } from "@/components/app/kit/IdentityStrip";
import { ReadPanel } from "@/components/app/kit/StatePanels";
import { useRevalidation, useRuntimeRead } from "@/components/app/kit/useRuntimeRead";
import { useSpringIdentity } from "@/components/app/SessionBadge";
import { refreshNotifications, useNotificationRefreshEpoch } from "@/lib/client/notificationRefresh";
import { gateRead } from "@/lib/client/runtimeHttp";
import {
  markAllNotificationsRead,
  markNotificationRead,
  notificationHref,
  notificationKindLabel,
  readNotifications,
  type NotificationItem,
} from "@/lib/client/runtimeNotifications";
import { runtimeRouteFor } from "@/lib/runtimeRoutes";
import { Module, Screen } from "@/lib/screens";

const ROUTE = "/app/model-label/notifications";
const LIST_TARGET = "list";
const loadList = () => readNotifications();

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function markReadFireAndForget(id: string) {
  void markNotificationRead(id).then((r) => {
    if (r.ok) refreshNotifications();
  });
}

export function Notifications({ module, screen }: { module: Module; screen: Screen }) {
  const identity = useSpringIdentity();
  const revalidation = useRevalidation();
  const notifyEpoch = useNotificationRefreshEpoch();
  const read = gateRead(
    identity.status,
    useRuntimeRead(`${LIST_TARGET}-${notifyEpoch}`, loadList, revalidation),
  );

  async function markOne(id: string) {
    const r = await markNotificationRead(id);
    if (r.ok) {
      refreshNotifications();
      revalidation.refresh();
    }
  }

  async function markAll() {
    const r = await markAllNotificationsRead();
    if (r.ok) {
      refreshNotifications();
      revalidation.refresh();
    }
  }

  return (
    <ScreenChrome module={module} screen={screen} subtitle="Updates about your applications" implemented={runtimeRouteFor(ROUTE)?.implemented}>
      <div className="space-y-space-md" data-testid="notifications-screen">
        <IdentityStrip identity={identity} testId="notifications-identity" />
        <ReadPanel
          title="Notifications"
          read={read}
          loadingText="Loading notifications…"
          loadingTestId="notifications-loading"
          errorTestId="notifications-error"
          signInReturnTo={ROUTE}
          isEmpty={(r) => r.list.items.length === 0}
          emptyText="No notifications yet."
          emptyTestId="notifications-empty"
          resultAction={(r) =>
            r.list.unread > 0 ? (
              <button
                type="button"
                onClick={() => void markAll()}
                className="px-space-md py-1.5 rounded-lg bg-primary text-on-primary font-label-md text-label-md"
                data-testid="notifications-mark-all"
              >
                Mark all read
              </button>
            ) : null
          }
        >
          {(r) => (
            <div className="space-y-space-md">
              <p className="font-label-sm text-label-sm text-on-surface-variant" data-testid="notifications-cap-note">
                Only the latest 50 notifications are shown.
              </p>
              <ul className="space-y-space-sm">
                {r.list.items.map((item: NotificationItem) => (
                  <li
                    key={item.id}
                    className="bg-surface-card rounded-xl shadow-sm p-space-md border border-border-subtle"
                    data-testid={`notifications-item-${item.id}`}
                    data-read={item.read ? "true" : "false"}
                  >
                    <div className="flex items-start gap-space-sm">
                      {!item.read ? (
                        <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" data-testid={`notifications-unread-dot-${item.id}`} aria-hidden />
                      ) : (
                        <span className="w-2 shrink-0" aria-hidden />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-space-sm gap-y-1">
                          <span className="font-label-sm text-label-sm text-primary font-semibold">{notificationKindLabel(item.kind)}</span>
                          <span className="font-label-sm text-label-sm text-on-surface-variant">{item.reference}</span>
                          <span className="font-label-sm text-label-sm text-on-surface-variant">{formatWhen(item.createdAt)}</span>
                        </div>
                        <p className="font-body-sm text-body-sm text-on-surface mt-1">{item.message}</p>
                        <div className="mt-space-sm flex flex-wrap gap-space-sm">
                          <Link
                            href={notificationHref(item)}
                            onClick={() => !item.read && markReadFireAndForget(item.id)}
                            className="text-primary font-label-md hover:underline"
                            data-testid={`notifications-open-${item.id}`}
                          >
                            Open
                          </Link>
                          {!item.read ? (
                            <button
                              type="button"
                              onClick={() => void markOne(item.id)}
                              className="text-on-surface-variant font-label-md hover:underline"
                              data-testid={`notifications-mark-read-${item.id}`}
                            >
                              Mark read
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ReadPanel>
      </div>
    </ScreenChrome>
  );
}
