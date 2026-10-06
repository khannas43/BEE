/**
 * Contract for the notification routes: GET /api/notifications, POST /api/notifications/{id}/read and POST /api/notifications/read-all.
 * Per-feature module (WP10.1a; the owner's assumptions, not BEE's decisions). Keep the validators and the allowed status and code tables
 * equal to the operations in the OpenAPI artifact.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const NOTIFICATION_KINDS = ["returned", "rejected", "fee_due", "approved"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  message: string;
  applicationId: string;
  reference: string;
  createdAt: string;
  read: boolean;
}
export interface NotificationList {
  unread: number;
  items: NotificationItem[];
}
export interface NotificationReadReceipt {
  id: string;
  unread: number;
}
export interface NotificationReadAllReceipt {
  marked: number;
  unread: number;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));

const validItem = (v: unknown): boolean => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const b = v as Record<string, unknown>;
  return exactKeys(b, ["id", "kind", "message", "applicationId", "reference", "createdAt", "read"]) && isString(b.id) && UUID.test(b.id) &&
    (NOTIFICATION_KINDS as readonly unknown[]).includes(b.kind) && isString(b.message) && b.message.length >= 1 && b.message.length <= 700 &&
    isString(b.applicationId) && UUID.test(b.applicationId) && isString(b.reference) && isInstant(b.createdAt) && typeof b.read === "boolean";
};

export const validateNotificationList: Validator<NotificationList> = (body) => {
  if (!exactKeys(body, ["unread", "items"])) return null;
  const b = body;
  // The unread count is never smaller than the unread items shown, because the list holds only the latest 50.
  const ok = isCount(b.unread) && Array.isArray(b.items) && b.items.length <= 50 && b.items.every(validItem) &&
    (b.items as { read: boolean }[]).filter((i) => !i.read).length <= (b.unread as number);
  return ok ? (b as unknown as NotificationList) : null;
};

export const validateNotificationRead: Validator<NotificationReadReceipt> = (body) =>
  exactKeys(body, ["id", "unread"]) && isString(body.id) && UUID.test(body.id) && isCount(body.unread) ? (body as unknown as NotificationReadReceipt) : null;

export const validateNotificationReadAll: Validator<NotificationReadAllReceipt> = (body) =>
  exactKeys(body, ["marked", "unread"]) && isCount(body.marked) && isCount(body.unread) ? (body as unknown as NotificationReadAllReceipt) : null;

export const SPRING_NOTIFICATIONS_ERRORS: UpstreamErrors = { 401: ["unauthenticated"], 403: RESOLVER_DENIALS, 503: ["service_unavailable"] };
export const SPRING_NOTIFICATION_READ_ERRORS: UpstreamErrors = { 401: ["unauthenticated"], 403: RESOLVER_DENIALS, 404: ["not_found"], 503: ["service_unavailable"] };

export const SPRING_NOTIFICATIONS = { errors: SPRING_NOTIFICATIONS_ERRORS, validate: validateNotificationList };
export const SPRING_NOTIFICATION_READ = { errors: SPRING_NOTIFICATION_READ_ERRORS, validate: validateNotificationRead, successStatuses: [200] as const };
export const SPRING_NOTIFICATION_READ_ALL = { errors: SPRING_NOTIFICATIONS_ERRORS, validate: validateNotificationReadAll, successStatuses: [200] as const };
