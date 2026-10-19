"use client";

import { useCallback, useEffect, useState } from "react";
import { type MessageItem, type MessageList, markAllMessagesRead, markMessageRead, readMessages } from "@/lib/client/runtimeMessages";
import { Icon } from "@/components/ui/Icon";
import { istStamp } from "@/lib/client/istTime";

/**
 * A person's simulated email and SMS messages (demonstration). The service writes one when a payment is received or declined, a ledger step
 * needs a second signature or is committed, or a production submission is sent, queried or accepted. Nothing is sent anywhere: this screen is
 * the inbox and the phone. It re-reads every few seconds so a presenter can keep it open in a second window. Local demonstration, not a BEE system.
 */
const FILTERS = [["all", "All"], ["email", "Email"], ["sms", "SMS"]] as const;
const POLL_MS = 8000;

const when = (iso: string) => `${istStamp(iso)} IST`;

export function MessagesDemo() {
  const [channel, setChannel] = useState<(typeof FILTERS)[number][0]>("all");
  const [data, setData] = useState<MessageList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    void readMessages().then((r) => {
      if (!live) return;
      if (r.ok) {
        setData(r.list);
        setError(null);
      } else {
        setError(r.failure.message);
      }
    });
    return () => {
      live = false;
    };
  }, [tick]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") reload(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  async function markRead(id: string) {
    const r = await markMessageRead(id);
    if (r.ok) reload();
    else setError(r.failure.message);
  }

  async function markAll() {
    const r = await markAllMessagesRead();
    if (r.ok) reload();
    else setError(r.failure.message);
  }

  const shown = (data?.items ?? []).filter((m) => channel === "all" || m.channel === channel);

  return (
    <div className="p-space-md lg:p-space-lg space-y-space-md" data-testid="demo-messages">
      <div>
        <h1 className="font-headline-md text-headline-md text-on-surface">Messages (email and SMS)</h1>
        <p role="note" className="font-body-sm text-on-surface-variant mt-1">
          Simulated: no email or text message is sent anywhere. These are the messages the system would send to you for the steps you and your colleagues take.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-space-sm">
        <div role="group" aria-label="Show" className="flex gap-1">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setChannel(key)} aria-pressed={channel === key}
              className={`rounded-full border px-3 py-1 font-label-md ${channel === key ? "bg-primary text-on-primary border-primary" : "border-outline-variant text-on-surface"}`} data-testid={`messages-filter-${key}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="font-label-md text-on-surface-variant" data-testid="messages-unread">{data ? `${data.unread} unread` : ""}</span>
        <button type="button" onClick={() => void markAll()} disabled={!data || data.unread === 0} className="ml-auto text-primary underline disabled:opacity-40" data-testid="messages-read-all">Mark all as read</button>
        <button type="button" onClick={reload} className="inline-flex items-center gap-1 text-primary underline" data-testid="messages-refresh"><Icon name="refresh" size={16} /> Refresh</button>
      </div>
      {error ? <p role="alert" className="text-error font-body-md">{error}</p> : null}
      {!data && !error ? <p role="status" className="font-body-md">Loading…</p> : null}
      {data && shown.length === 0 ? <p className="font-body-md" data-testid="messages-empty">No messages yet. They appear here as payments, ledger steps and production submissions happen.</p> : null}
      <ul className="space-y-space-sm" data-testid="messages-list">
        {shown.map((m: MessageItem) => (
          <li key={m.id} data-testid="message" data-channel={m.channel} data-read={m.read}
            className={`rounded-xl border p-space-md ${m.read ? "border-outline-variant bg-surface-card" : "border-primary/40 bg-primary/5"} ${m.channel === "sms" ? "max-w-xl" : ""}`}>
            <div className="flex flex-wrap items-center gap-space-sm font-label-sm text-on-surface-variant">
              <span className="inline-flex items-center gap-1 font-semibold"><Icon name={m.channel === "email" ? "mail" : "sms"} size={16} /> {m.channel === "email" ? "Email" : "SMS"}</span>
              <span>to {m.address}</span>
              <span className="ml-auto">{when(m.createdAt)}</span>
            </div>
            {m.subject ? <p className="font-title-md text-title-md text-on-surface mt-1">{m.subject}</p> : null}
            <p className="font-body-md text-on-surface mt-1">{m.body}</p>
            {!m.read ? <button type="button" onClick={() => void markRead(m.id)} className="mt-space-xs text-primary underline font-label-md" aria-label={`Mark as read: ${m.subject ?? m.body.slice(0, 40)}`}>Mark as read</button> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
