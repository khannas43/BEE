/**
 * Browser client for in-portal notifications (WP10.1b): list, mark one read, mark all read.
 */
import { demoGet, demoPath, type DemoBody } from "@/lib/client/runtimeDemo";
import { type FetchLike, type ReadFailure, runtimeAction, runtimeRead } from "@/lib/client/runtimeHttp";
import { modelDashboardHref } from "@/lib/client/runtimeModelApplications";
import { modelDraftFormHref } from "@/lib/client/runtimeModelDrafts";

export const NOTIFICATION_KINDS = ["returned", "rejected", "fee_due", "approved"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Company-onboarding notices: not in the documented notifications contract, read through the demonstration API (`staff-notices`). */
export type OnboardingNoticeKind = "manufacturer_onboarding_director_review" | "manufacturer_onboarding_information";
export const ONBOARDING_NOTICE_KINDS: readonly OnboardingNoticeKind[] = ["manufacturer_onboarding_director_review", "manufacturer_onboarding_information"];

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

/** The same shape the server accepts: any 8-4-4-4-12 hex id. The seeded fixtures use ids whose version and variant digits are not RFC 4122 ones. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/** The contract list, plus (for BEE staff, who receive them) the person's company-onboarding notices, newest first. A failure to read the extra notices never hides the contract list. */
export type ListedNotification = Omit<NotificationItem, "kind"> & { kind: NotificationKind | OnboardingNoticeKind };
export type AllNotificationsRead = { ok: true; list: { unread: number; items: ListedNotification[] } } | { ok: false; failure: ReadFailure };

export async function readAllNotifications(withOnboarding: boolean, fetchImpl: FetchLike = fetch): Promise<AllNotificationsRead> {
  const base = await readNotifications(fetchImpl);
  if (!base.ok || !withOnboarding) return base;
  const extra = await demoGet<DemoBody & { items?: ListedNotification[]; unread?: number }>(demoPath("staff-notices"));
  const more = extra.ok && Array.isArray(extra.value.items) ? extra.value.items.filter((i) => (ONBOARDING_NOTICE_KINDS as readonly string[]).includes(i.kind)) : [];
  const items = [...(base.list.items as ListedNotification[]), ...more].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { ok: true, list: { unread: base.list.unread + more.filter((i) => !i.read).length, items } };
}

export function markNotificationRead(id: string, fetchImpl?: FetchLike) {
  return runtimeAction(notificationReadPath(id), parseReadReceipt, fetchImpl);
}

export function markAllNotificationsRead(fetchImpl?: FetchLike) {
  return runtimeAction(NOTIFICATIONS_READ_ALL_PATH, parseReadAllReceipt, fetchImpl);
}

export function notificationKindLabel(kind: ListedNotification["kind"]): string {
  switch (kind) {
    case "manufacturer_onboarding_director_review":
      return "Company registration to review";
    case "manufacturer_onboarding_information":
      return "Company registration update";
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

export function notificationHref(item: Pick<ListedNotification, "kind" | "applicationId">): string {
  switch (item.kind) {
    case "manufacturer_onboarding_director_review":
    case "manufacturer_onboarding_information":
      return "/app/demo/manufacturer-360";
    case "returned":
      return modelDraftFormHref(item.applicationId);
    case "approved":
      return `/app/model-label/label-preview?id=${encodeURIComponent(item.applicationId)}`;
    case "fee_due":
    case "rejected":
      return modelDashboardHref(item.applicationId);
  }
}
