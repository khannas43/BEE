/**
 * Production details (demonstration API `/api/demo/production-details`, outside the contract), after section 1.3 of the SOP for the BEE S&L portal:
 * what was produced per model in each quarter of a financial year, the serial numbers linked to each production line, and the label fee with its
 * payment. The fee rate is a placeholder. Local demonstration, not BEE rules.
 */
import { demoGet, demoPath, demoPost, type DemoBody } from "@/lib/client/runtimeDemo";

export type SerialCounts = { total: number; bound: number; voided: number };
export type LineQuarter = { fq: number; units: number; serials: SerialCounts };
export type ProductionLine = { applicationId: string; model: string; brand: string; reference: string; registrationId: string | null; mark: "" | "expired" | "withdrawn"; quarters: LineQuarter[] };
export type QuarterPayment = { status: "initiated" | "paid"; orderId: string; method: string | null; receipt: string | null };
export type QuarterTotal = {
  fq: number; label: string; calendarQuarter: string; units: number; fee: string; payment: QuarterPayment | null;
  submission: { id: string; state: string; evidence: number } | null; open?: boolean;
};
export type FeeOrderRow = { orderId: string; financialYear: string; quarters: string; amount: string; status: string; method: string | null; receipt: string | null; at: string };
export type ProductionDetailsView = {
  staff: boolean; feePerUnit: string; equipment: string; organisations?: { code: string; name: string }[]; organisation?: string; organisationCode?: string;
  financialYear?: string; years: string[]; lines: ProductionLine[]; quarters?: QuarterTotal[]; payable?: string; paid?: string; balance?: string; orders?: FeeOrderRow[];
};
export type SerialPage = { model: string; total: number; offset: number; limit: number; serials: { serial: string; state: string; allocatedAt: string; boundAt: string | null; batch: string }[]; batches: { id: string; quantity: number; status: string; createdAt: string }[] };
export type FeeOrder = { orderId: string; financialYear: string; equipment: string; firm: string; items: { fq: number; label: string; units: number; amount: string }[]; amount: string; currency: string; methods: string[] };
export type PayResult = { orderId: string; method: string; gatewayRef: string; status: "paid" | "failed" | "awaiting_confirmation"; receipt?: string; note?: string };

export const METHOD_WORD: Record<string, string> = { billdesk: "BillDesk", razorpay: "Razorpay", direct_transfer: "Direct transfer" };
export const inr = (v: string | number) => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: Number(v) % 1 ? 2 : 0 })}`;

type Res<T> = Promise<{ ok: true; value: T } | { ok: false; message: string }>;
const path = (part?: string) => demoPath("production-details", ...(part ? [part] : []));

export async function readDetails(fy?: string, organisation?: string): Res<ProductionDetailsView> {
  const q = new URLSearchParams();
  if (fy) q.set("fy", fy);
  if (organisation) q.set("organisation", organisation);
  const r = await demoGet<DemoBody>(`${path()}${q.size ? `?${q}` : ""}`);
  return r.ok && Array.isArray(r.value.lines) ? { ok: true, value: r.value as unknown as ProductionDetailsView } : { ok: false, message: r.ok ? "Unexpected answer." : r.message };
}

export async function readLine(p: { app: string; fy: string; fq: number; offset: number; state: string; organisation?: string }): Res<SerialPage> {
  const q = new URLSearchParams({ app: p.app, fy: p.fy, fq: String(p.fq), offset: String(p.offset), limit: "10" });
  if (p.state) q.set("state", p.state);
  if (p.organisation) q.set("organisation", p.organisation);
  const r = await demoGet<DemoBody>(`${path("line")}?${q}`);
  return r.ok && Array.isArray(r.value.serials) ? { ok: true, value: r.value as unknown as SerialPage } : { ok: false, message: r.ok ? "Unexpected answer." : r.message };
}

async function write<T>(url: string, body: object): Res<T> {
  const r = await demoPost<DemoBody>(url, body);
  return r.ok ? { ok: true, value: r.value as unknown as T } : { ok: false, message: r.message };
}
export const makeSerials = (applicationId: string, fy: string, fq: number, quantity: number) => write<{ batch: string; quantity: number }>(path("serials"), { applicationId, fy, fq, quantity });
export const startOrder = (fy: string, quarters: number[]) => write<FeeOrder>(path("pay"), { fy, quarters });
export const completeOrder = (orderId: string, method: string, outcome: "paid" | "failed") => write<PayResult>(demoPath("production-details", orderId, "complete"), { method, outcome });
export const cancelOrder = (orderId: string) => write<{ orderId: string; status: string }>(demoPath("production-details", orderId, "cancel"), {});
export const saveUnits = (fy: string, fq: number, units: Record<string, string>) => write<{ submissionId: string; models: number; units: number }>(path("units"), { fy, fq, units });
export const submitSubmission = (submissionId: string) => write<{ state: string }>(demoPath("production", submissionId, "submit"), {});
