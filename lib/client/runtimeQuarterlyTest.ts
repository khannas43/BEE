/**
 * BEE's test of a product in a quarter (demonstration API `/api/demo/quarterly-test`, outside the contract). A manufacturer reads its own
 * results; BEE Officer, Programme and Admin record them. Local demonstration, not BEE rules.
 */
import { demoGet, demoPath, demoPost, type DemoBody } from "@/lib/client/runtimeDemo";

export type TestResult = "pass" | "fail" | "retest";
export type QuarterlyTest = {
  organisationId: string; organisation: string; quarter: string; registrationId: string; modelNumber: string; result: TestResult;
  measuredIseer: string | null; testedOn: string; laboratory: string | null; remarks: string | null; recordedBy: string | null; recordedAt: string;
};

export const RESULT_WORD: Record<TestResult, string> = { pass: "Passed", fail: "Failed", retest: "Retest needed" };
export const RESULT_TONE: Record<TestResult, string> = {
  pass: "bg-[#e2f3e8] text-[#14532d] border-[#b7e0c6]", fail: "bg-[#fdecea] text-[#93000a] border-[#f5c2c0]", retest: "bg-[#fff4d6] text-[#8a4b00] border-[#f3dc9c]",
};

export async function readQuarterlyTests(quarter?: string): Promise<{ ok: true; results: QuarterlyTest[]; canRecord: boolean } | { ok: false; message: string }> {
  const r = await demoGet<DemoBody & { results: QuarterlyTest[]; canRecord: boolean }>(`${demoPath("quarterly-test")}${quarter ? `?quarter=${encodeURIComponent(quarter)}` : ""}`);
  return r.ok && Array.isArray(r.value.results) ? { ok: true, results: r.value.results, canRecord: Boolean(r.value.canRecord) } : { ok: false, message: r.ok ? "Unexpected answer." : r.message };
}

export async function recordQuarterlyTest(body: { quarter: string; registrationId: string; result: TestResult; testedOn: string; measuredIseer?: string; laboratoryCode?: string; remarks?: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const r = await demoPost(demoPath("quarterly-test"), body);
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}
