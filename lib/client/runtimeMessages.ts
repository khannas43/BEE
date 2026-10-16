/**
 * Browser client for the simulated email and SMS messages (BL-229; nothing is ever sent): list, mark one read, mark all read.
 * The same exact-shape rules as the portal boundary (lib/server/contracts/messages.ts).
 */
import { type FetchLike, type ReadFailure, runtimeAction, runtimeRead } from "@/lib/client/runtimeHttp";

export const MESSAGE_CHANNELS = ["email", "sms"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export type MessageItem = {
  id: string;
  channel: MessageChannel;
  address: string;
  kind: string;
  reference: string | null;
  subject: string | null;
  body: string;
  createdAt: string;
  read: boolean;
};
export type MessageList = { unread: number; items: MessageItem[] };
export type MessageReadReceipt = { id: string; unread: number };
export type MessageReadAllReceipt = { marked: number; unread: number };
export type MessagesRead = { ok: true; list: MessageList } | { ok: false; failure: ReadFailure };

export const MESSAGES_PATH = "/api/runtime/messages";
export const messageReadPath = (id: string) => `/api/runtime/messages/${encodeURIComponent(id)}/read`;
export const MESSAGES_READ_ALL_PATH = "/api/runtime/messages/read-all";

/** The same shape the server accepts: any 8-4-4-4-12 hex id (the seeded fixtures use ids that are not RFC 4122 ones). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function exactKeys(obj: unknown, keys: readonly string[]): obj is Record<string, unknown> {
  return typeof obj === "object" && obj !== null && !Array.isArray(obj) && Object.keys(obj).length === keys.length && keys.every((k) => k in obj);
}
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isString = (v: unknown): v is string => typeof v === "string";
const isInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));

function parseItem(body: unknown): MessageItem | null {
  if (!exactKeys(body, ["id", "channel", "address", "kind", "reference", "subject", "body", "createdAt", "read"])) return null;
  const b = body;
  const subjectOk = b.channel === "email" ? isString(b.subject) && b.subject.length >= 1 : b.subject === null;
  if (
    !isString(b.id) || !UUID.test(b.id) || !(MESSAGE_CHANNELS as readonly unknown[]).includes(b.channel) || !isString(b.address) || b.address.length < 1 ||
    !isString(b.kind) || !/^[a-z_]{3,40}$/.test(b.kind) || !(b.reference === null || isString(b.reference)) || !subjectOk ||
    !isString(b.body) || b.body.length < 1 || b.body.length > 1000 || !isInstant(b.createdAt) || typeof b.read !== "boolean"
  ) {
    return null;
  }
  return b as MessageItem;
}

export function parseMessageList(body: unknown): MessageList | null {
  if (!exactKeys(body, ["unread", "items"])) return null;
  const b = body;
  if (!isCount(b.unread) || !Array.isArray(b.items) || b.items.length > 50) return null;
  const items: MessageItem[] = [];
  for (const row of b.items) {
    const item = parseItem(row);
    if (!item) return null;
    items.push(item);
  }
  if (items.filter((i) => !i.read).length > b.unread) return null;
  return { unread: b.unread, items };
}

function parseReadReceipt(body: unknown): MessageReadReceipt | null {
  if (!exactKeys(body, ["id", "unread"])) return null;
  return isString(body.id) && UUID.test(body.id) && isCount(body.unread) ? (body as MessageReadReceipt) : null;
}

function parseReadAllReceipt(body: unknown): MessageReadAllReceipt | null {
  if (!exactKeys(body, ["marked", "unread"])) return null;
  return isCount(body.marked) && isCount(body.unread) ? (body as MessageReadAllReceipt) : null;
}

export async function readMessages(fetchImpl: FetchLike = fetch): Promise<MessagesRead> {
  const r = await runtimeRead(MESSAGES_PATH, parseMessageList, fetchImpl);
  return r.ok ? { ok: true, list: r.value } : r;
}

export function markMessageRead(id: string, fetchImpl?: FetchLike) {
  return runtimeAction(messageReadPath(id), parseReadReceipt, fetchImpl);
}

export function markAllMessagesRead(fetchImpl?: FetchLike) {
  return runtimeAction(MESSAGES_READ_ALL_PATH, parseReadAllReceipt, fetchImpl);
}
