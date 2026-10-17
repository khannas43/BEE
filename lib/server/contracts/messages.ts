/**
 * Contract for the message routes: GET /api/messages, POST /api/messages/{id}/read and POST /api/messages/read-all (simulated email and SMS
 * for the local demonstration; nothing is ever sent). Per-feature module (BL-229; the owner's assumptions, not BEE's decisions). Keep the
 * validators and the allowed status and code tables equal to the operations in the OpenAPI artifact.
 */
import { exactKeys, isString, RESOLVER_DENIALS, type UpstreamErrors, UUID, type Validator } from "@/lib/server/apiContract";

export const MESSAGE_CHANNELS = ["email", "sms"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export interface MessageItem {
  id: string;
  channel: MessageChannel;
  address: string;
  kind: string;
  reference: string | null;
  subject: string | null;
  body: string;
  createdAt: string;
  read: boolean;
}
export interface MessageList {
  unread: number;
  items: MessageItem[];
}
export interface MessageReadReceipt {
  id: string;
  unread: number;
}
export interface MessageReadAllReceipt {
  marked: number;
  unread: number;
}

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));
const nullableString = (v: unknown): boolean => v === null || isString(v);

const validItem = (v: unknown): boolean => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const b = v as Record<string, unknown>;
  // An email has a subject; an SMS has none.
  const subjectOk = b.channel === "email" ? isString(b.subject) && b.subject.length >= 1 : b.subject === null;
  return exactKeys(b, ["id", "channel", "address", "kind", "reference", "subject", "body", "createdAt", "read"]) && isString(b.id) && UUID.test(b.id) &&
    (MESSAGE_CHANNELS as readonly unknown[]).includes(b.channel) && isString(b.address) && b.address.length >= 1 &&
    isString(b.kind) && /^[a-z_]{3,40}$/.test(b.kind) && nullableString(b.reference) && subjectOk &&
    isString(b.body) && b.body.length >= 1 && b.body.length <= 1000 && isInstant(b.createdAt) && typeof b.read === "boolean";
};

export const validateMessageList: Validator<MessageList> = (body) => {
  if (!exactKeys(body, ["unread", "items"])) return null;
  const b = body;
  // The unread count is never smaller than the unread items shown, because the list holds only the latest 50.
  const ok = isCount(b.unread) && Array.isArray(b.items) && b.items.length <= 50 && b.items.every(validItem) &&
    (b.items as { read: boolean }[]).filter((i) => !i.read).length <= (b.unread as number);
  return ok ? (b as unknown as MessageList) : null;
};

export const validateMessageRead: Validator<MessageReadReceipt> = (body) =>
  exactKeys(body, ["id", "unread"]) && isString(body.id) && UUID.test(body.id) && isCount(body.unread) ? (body as unknown as MessageReadReceipt) : null;

export const validateMessageReadAll: Validator<MessageReadAllReceipt> = (body) =>
  exactKeys(body, ["marked", "unread"]) && isCount(body.marked) && isCount(body.unread) ? (body as unknown as MessageReadAllReceipt) : null;

export const SPRING_MESSAGES_ERRORS: UpstreamErrors = { 401: ["unauthenticated"], 403: RESOLVER_DENIALS, 503: ["service_unavailable"] };
export const SPRING_MESSAGE_READ_ERRORS: UpstreamErrors = { 401: ["unauthenticated"], 403: RESOLVER_DENIALS, 404: ["not_found"], 503: ["service_unavailable"] };

export const SPRING_MESSAGES = { errors: SPRING_MESSAGES_ERRORS, validate: validateMessageList };
export const SPRING_MESSAGE_READ = { errors: SPRING_MESSAGE_READ_ERRORS, validate: validateMessageRead, successStatuses: [200] as const };
export const SPRING_MESSAGE_READ_ALL = { errors: SPRING_MESSAGES_ERRORS, validate: validateMessageReadAll, successStatuses: [200] as const };
