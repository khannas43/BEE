/**
 * Browser client for in-portal notifications (WP10.1b): list, mark one read, mark all read.
 */
import { type FetchLike, type ReadFailure, runtimeAction, runtimeRead } from "@/lib/client/runtimeHttp";
import { modelDashboardHref } from "@/lib/client/runtimeModelApplications";
import { modelDraftFormHref } from "@/lib/client/runtimeModelDrafts";

export const NOTIFICATION_KINDS = ["returned", "rejected", "fee_due", "approved"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  message: string;
  applicationId: string;
  reference: string;
  createdAt: string;
  read: boolean;
};

export type NotificationList = {
  unread: number;
  items: NotificationItem[];
};

export type NotificationReadReceipt = { id: string; unread: number };
export type NotificationReadAllReceipt = { marked: number; unread: number };

export type NotificationsRead = { ok: true; list: NotificationList } | { ok: false; failure: ReadFailure };

export const NOTIFICATIONS_PATH = "/api/runtime/notifications";
export const notificationReadPath = (id: string) => `/api/runtime/notifications/${encodeURIComponent(id)}/read`;
export const NOTIFICATIONS_READ_ALL_PATH = "/api/runtime/notifications/read-all";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactKeys(obj: unknown, keys: readonly string[]): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj) && Object.keys(obj).length === keys.length && keys.every((k) => k in obj);
}

function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isInstant(v: unknown): v is string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

function parseItem(body: unknown): NotificationItem | null {
  if (!exactKeys(body, ["id", "kind", "message", "applicationId", "reference", "createdAt", "read"])) return null;
  const b = body;
  if (
    typeof b.id !== "string" ||
    !UUID.test(b.id) ||
    !(NOTIFICATION_KINDS as readonly unknown[]).includes(b.kind) ||
    typeof b.message !== "string" ||
    b.message.length < 1 ||
    b.message.length > 700 ||
    typeof b.applicationId !== "string" ||
    !UUID.test(b.applicationId) ||
    typeof b.reference !== "string" ||
    !isInstant(b.createdAt) ||
    typeof b.read !== "boolean"
  ) {
    return null;
  }
  return b as NotificationItem;
}

export function parseNotificationList(body: unknown): NotificationList | null {
  if (!exactKeys(body, ["unread", "items"])) return null;
  const b = body;
  if (!isCount(b.unread) || !Array.isArray(b.items) || b.items.length > 50) return null;
  const items: NotificationItem[] = [];
  for (const row of b.items) {
    const item = parseItem(row);
    if (!item) return null;
    items.push(item);
  }
  const unreadInList = items.filter((i) => !i.read).length;
  if (unreadInList > b.unread) return null;
  return { unread: b.unread, items };
}

function parseReadReceipt(body: unknown): NotificationReadReceipt | null {
  if (!exactKeys(body, ["id", "unread"])) return null;
  const b = body;
  return typeof b.id === "string" && UUID.test(b.id) && isCount(b.unread) ? (b as NotificationReadReceipt) : null;
}

function parseReadAllReceipt(body: unknown): NotificationReadAllReceipt | null {
  if (!exactKeys(body, ["marked", "unread"])) return null;
  const b = body;
  return isCount(b.marked) && isCount(b.unread) ? (b as NotificationReadAllReceipt) : null;
}

export async function readNotifications(fetchImpl: FetchLike = fetch): Promise<NotificationsRead> {
  const r = await runtimeRead(NOTIFICATIONS_PATH, parseNotificationList, fetchImpl);
  return r.ok ? { ok: true, list: r.value } : r;
}

export function markNotificationRead(id: string, fetchImpl?: FetchLike) {
  return runtimeAction(notificationReadPath(id), parseReadReceipt, fetchImpl);
}

export function markAllNotificationsRead(fetchImpl?: FetchLike) {
  return runtimeAction(NOTIFICATIONS_READ_ALL_PATH, parseReadAllReceipt, fetchImpl);
}

export function notificationKindLabel(kind: NotificationKind): string {
  switch (kind) {
    case "returned":
      return "Returned";
    case "rejected":
      return "Rejected";
    case "fee_due":
      return "Fee due";
    case "approved":
      return "Approved";
  }
}

export function notificationHref(item: Pick<NotificationItem, "kind" | "applicationId">): string {
  switch (item.kind) {
    case "returned":
      return modelDraftFormHref(item.applicationId);
    case "approved":
      return `/app/model-label/label-preview?id=${encodeURIComponent(item.applicationId)}`;
    case "fee_due":
    case "rejected":
      return modelDashboardHref(item.applicationId);
  }
}
