/**
 * Sign-in and action trail (demonstration API `/api/demo/activity`, outside the contract): who signed in, from which address, and what they did.
 * A manufacturer reads its own organisation's people; the BEE oversight roles read everyone. Local demonstration, not BEE rules.
 */
import { demoGet, demoPath, type DemoBody } from "@/lib/client/runtimeDemo";

export type ActivityEvent = {
  at: string; username: string; name: string; role: string; organisationCode: string | null; organisation: string | null;
  ip: string; kind: "login" | "action"; action: string; target: string | null;
};
export type ActivityPerson = { username: string; name: string; role: string; organisation: string | null; logins: number; actions: number; lastSeen: string; lastIp: string; addresses: number };
export type ActivityLog = { events: ActivityEvent[]; people: ActivityPerson[]; organisations: { code: string; name: string }[]; scope: "all" | "own"; limit: number };

const ROLE_WORD: Record<string, string> = {
  manufacturer: "Manufacturer", agency: "Agency", officer: "BEE Officer", director: "Director", secretary: "Secretary", admin: "Administrator",
  finance: "Finance", auditor: "Auditor", programme: "Programme", reviewer: "Reviewer", helpdesk: "Helpdesk", iame: "IAME",
};
export const roleWord = (role: string) => ROLE_WORD[role] ?? role;

export async function readActivity(): Promise<{ ok: true; log: ActivityLog } | { ok: false; message: string }> {
  const r = await demoGet<DemoBody & ActivityLog>(demoPath("activity"));
  return r.ok && Array.isArray(r.value.events) && Array.isArray(r.value.people)
    ? { ok: true, log: { events: r.value.events, people: r.value.people, organisations: r.value.organisations ?? [], scope: r.value.scope === "all" ? "all" : "own", limit: r.value.limit ?? 500 } }
    : { ok: false, message: r.ok ? "Unexpected answer." : r.message };
}
