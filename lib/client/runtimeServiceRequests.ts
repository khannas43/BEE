/**
 * Service requests (demonstration API `/api/demo/service-requests`, outside the contract): a manufacturer asks for a renewal or a withdrawal
 * of a certificate, or for help; BEE staff answer. Local demonstration, not BEE rules.
 */
import { demoGet, demoPath, demoPost, type DemoBody } from "@/lib/client/runtimeDemo";

export type RequestKind = "renewal" | "withdrawal" | "helpdesk";
export type RequestStatus = "submitted" | "acknowledged" | "resolved" | "declined";
export type ServiceRequest = {
  id: string; reference: string; kind: RequestKind; organisation: string; subjectRef: string | null; subject: string; message: string | null; category: string | null;
  status: RequestStatus; createdAt: string; createdBy: string | null; responseNote: string | null; respondedAt: string | null; respondedBy: string | null;
};
export type RequestList = { requests: ServiceRequest[]; staff: boolean; canRespond: boolean; canCreate: boolean };

export const KIND_WORD: Record<RequestKind, string> = { renewal: "Renewal", withdrawal: "Withdrawal", helpdesk: "Helpdesk" };
export const STATUS_WORD: Record<RequestStatus, string> = { submitted: "Submitted", acknowledged: "Acknowledged", resolved: "Resolved", declined: "Declined" };
export const STATUS_TONE: Record<RequestStatus, string> = {
  submitted: "bg-[#e7effb] text-[#14315E] border-[#c9d9f7]", acknowledged: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
  resolved: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]", declined: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]",
};

export async function readServiceRequests(): Promise<{ ok: true; list: RequestList } | { ok: false; message: string }> {
  const r = await demoGet<DemoBody & RequestList>(demoPath("service-requests"));
  return r.ok && Array.isArray(r.value.requests) ? { ok: true, list: { requests: r.value.requests, staff: Boolean(r.value.staff), canRespond: Boolean(r.value.canRespond), canCreate: Boolean(r.value.canCreate) } } : { ok: false, message: r.ok ? "Unexpected answer." : r.message };
}

export async function createServiceRequest(body: { kind: RequestKind; subject: string; subjectRef?: string; message?: string; category?: string }): Promise<{ ok: true; reference: string } | { ok: false; message: string }> {
  const r = await demoPost(demoPath("service-requests"), body);
  return r.ok ? { ok: true, reference: String(r.value.reference ?? "") } : { ok: false, message: r.message };
}

export async function respondToRequest(id: string, status: Exclude<RequestStatus, "submitted">, note: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await demoPost(demoPath("service-requests", id, "respond"), { status, note });
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}
