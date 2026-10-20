/**
 * Random testing of products by BEE (demonstration API `/api/demo/product-testing`, outside the contract). BEE buys units from the market and
 * tests them at its own cost; products are chosen from compliance risk and customer grievances, or by a risk-weighted random draw. The BEE
 * Officer works the cases; a manufacturer reads its own results and the grievance count and category per product. Local demonstration.
 */
import { demoGet, demoPath, demoPost, type DemoBody } from "@/lib/client/runtimeDemo";

export type Stage = "selected" | "procured" | "at_lab" | "result_in" | "closed";
export const STAGES: Stage[] = ["selected", "procured", "at_lab", "result_in", "closed"];
export const STAGE_WORD: Record<Stage, string> = { selected: "Selected", procured: "Bought from market", at_lab: "At laboratory", result_in: "Result in", closed: "Closed" };
export const SOURCE_WORD: Record<string, string> = { qr_scan: "QR label scan", helpline: "Helpline", email: "Email", consumer_portal: "Consumer portal", forum: "Retailer or consumer forum" };
export const CATEGORY_WORD: Record<string, string> = { cooling: "Cooling performance", power: "Power consumption", noise: "Noise", label: "Label", counterfeit: "Suspected counterfeit", other: "Other" };
export const RESULT_WORD: Record<string, string> = { pass: "Pass", fail: "Fail", retest: "Retest" };
export const RECOMMENDATION_WORD: Record<string, string> = { none: "No further action", review: "Recommend a review", hold: "Recommend a hold" };

export type Factor = { label: string; points: number };
export type RankedProduct = {
  registrationId: string; model: string; brand: string; manufacturer: string; organisationId: string; stars: number; ratedIseer: string;
  grievances: number; score: number; band: "high" | "medium" | "low"; factors: Factor[]; openCase: string | null;
};
export type Overview = {
  openGrievances: number; grievancesLast30: number; flagged: number; resultsThisQuarter: number;
  stages: Record<Stage, number>; sources: Record<string, number>; categories: Record<string, number>; top: RankedProduct[];
};
export type Grievance = {
  reference: string; source: string; category: string; registrationId: string; model: string; brand: string; manufacturer: string; summary: string;
  complainant: string | null; contact: string | null; receivedAt: string; status: "open" | "in_testing" | "closed";
};
export type CaseEvent = { stage: Stage; note: string | null; at: string; by: string | null };
export type TestCase = {
  id: string; reference: string; registrationId: string; model: string; brand: string; manufacturer: string; basis: "risk" | "random" | "manual"; reason: string;
  riskScore: number | null; stage: Stage; procuredFrom: string | null; laboratory: string | null; result: "pass" | "fail" | "retest" | null;
  measuredIseer: string | null; ratedIseer: string | null; testedOn: string | null; recommendation: "none" | "review" | "hold" | null;
  selectedAt: string; updatedAt: string; history: CaseEvent[];
};
export type MineProduct = {
  registrationId: string; model: string; brand: string; stars: number; ratedIseer: string; validTo: string;
  grievances: { total: number; last90: number; byCategory: Record<string, number> };
  tests: { reference: string; result: "pass" | "fail" | "retest"; measuredIseer: string | null; ratedIseer: string | null; testedOn: string | null; laboratory: string | null }[];
};

export type ProductView = {
  product: RankedProduct;
  anomaly: { found: boolean; status?: "normal" | "flagged"; quarters?: { quarter: string; units: number; zVsOthers: number }[]; mean?: number; boundSerials?: number | null; flags?: { type: string; quarter: string; detail: string }[] };
  grievances: { total: number; last90: number; byCategory: Record<string, number>; bySource: Record<string, number>; latest: { reference: string; source: string; category: string; summary: string; complainant: string | null; receivedAt: string; status: string }[] };
  cases: TestCase[];
};

type Read<T> = Promise<{ ok: true; value: T } | { ok: false; message: string }>;
async function read<T>(part: string, check: (b: DemoBody) => boolean): Read<T> {
  const r = await demoGet<DemoBody>(demoPath("product-testing", part));
  return r.ok && check(r.value) ? { ok: true, value: r.value as unknown as T } : { ok: false, message: r.ok ? "Unexpected answer." : r.message };
}

export const readOverview = () => read<Overview>("overview", (b) => typeof b.stages === "object" && b.stages !== null);
export const readGrievances = () => read<{ grievances: Grievance[] }>("grievances", (b) => Array.isArray(b.grievances));
export const readSelection = () => read<{ products: RankedProduct[]; total: number }>("selection", (b) => Array.isArray(b.products));
export const readCases = () => read<{ cases: TestCase[] }>("cases", (b) => Array.isArray(b.cases));
export async function readProduct(reg: string): Read<ProductView> {
  const r = await demoGet<DemoBody>(`${demoPath("product-testing", "product")}?reg=${encodeURIComponent(reg)}`);
  return r.ok && typeof r.value.product === "object" ? { ok: true, value: r.value as unknown as ProductView } : { ok: false, message: r.ok ? "Unexpected answer." : r.message };
}
export const readMine = () => read<{ products: MineProduct[]; note: string }>("mine", (b) => Array.isArray(b.products));

async function write(path: string, body: object): Promise<{ ok: true; value: DemoBody } | { ok: false; message: string }> {
  const r = await demoPost(path, body);
  return r.ok ? { ok: true, value: r.value } : { ok: false, message: r.message };
}
export const addToTesting = (registrationId: string, reason?: string) => write(demoPath("product-testing", "cases"), { registrationId, basis: "risk", reason });
export const drawAtRandom = (size: number) => write(demoPath("product-testing", "draw"), { size });
export const advanceCase = (id: string, body: Record<string, string>) => write(demoPath("product-testing", id, "advance"), body);
