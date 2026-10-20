/**
 * Product details of a model application (demonstration API `/api/demo/model-technical/{applicationId}`, outside the contract):
 * air-conditioner type, rated cooling capacity and power input, compressor, refrigerant, rated voltage and test report number.
 * Local demonstration, not BEE rules.
 */
import { demoGet, demoPath, demoPost } from "@/lib/client/runtimeDemo";

export type TechnicalDetails = {
  acType: string;
  compressorType: string;
  refrigerant: string;
  ratedVoltage: string;
  coolingCapacityW: string;
  powerInputW: string;
  testReportNumber: string;
};

export const NO_TECHNICAL: TechnicalDetails = { acType: "", compressorType: "", refrigerant: "", ratedVoltage: "", coolingCapacityW: "", powerInputW: "", testReportNumber: "" };

export const AC_TYPES: [string, string][] = [["split", "Split"], ["window", "Window"], ["cassette", "Cassette"], ["portable", "Portable"]];
export const COMPRESSORS: [string, string][] = [["fixed", "Fixed speed"], ["inverter", "Inverter"]];
export const REFRIGERANTS: [string, string][] = [["R32", "R32"], ["R410A", "R410A"], ["R290", "R290"], ["R22", "R22"]];

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function toDetails(body: Record<string, unknown>): TechnicalDetails {
  return {
    acType: str(body.acType), compressorType: str(body.compressorType), refrigerant: str(body.refrigerant), ratedVoltage: str(body.ratedVoltage),
    coolingCapacityW: str(body.coolingCapacityW), powerInputW: str(body.powerInputW), testReportNumber: str(body.testReportNumber),
  };
}

const whole = (t: string, min: number, max: number) => /^\d+$/.test(t.trim()) && Number(t) >= min && Number(t) <= max;

/** What is wrong with the figures, in words; empty when every entered figure is acceptable (empty fields are not an error here). */
export function technicalProblems(d: TechnicalDetails): string[] {
  const out: string[] = [];
  if (d.coolingCapacityW.trim() && !whole(d.coolingCapacityW, 500, 30000)) out.push("Rated cooling capacity must be a whole number of watts from 500 to 30000.");
  if (d.powerInputW.trim() && !whole(d.powerInputW, 100, 15000)) out.push("Rated power input must be a whole number of watts from 100 to 15000.");
  if (d.ratedVoltage.trim() && !whole(d.ratedVoltage, 180, 260)) out.push("Rated voltage must be a whole number from 180 to 260.");
  if (d.testReportNumber.trim() && (d.testReportNumber.trim().length < 3 || d.testReportNumber.trim().length > 60)) out.push("Test report number must be 3 to 60 characters.");
  return out;
}

/** Every product detail has been entered (the form asks for all of them before the application is reviewed for submit). */
export const technicalComplete = (d: TechnicalDetails) => Object.values(d).every((v) => v.trim() !== "") && technicalProblems(d).length === 0;

/** Cooling capacity divided by power input: the energy efficiency ratio, a plain check on the two figures. */
export function eerOf(d: TechnicalDetails): number | null {
  const c = Number(d.coolingCapacityW), p = Number(d.powerInputW);
  return Number.isFinite(c) && Number.isFinite(p) && p > 0 && c > 0 ? Math.round((c / p) * 100) / 100 : null;
}

export async function readTechnicalDetails(applicationId: string): Promise<{ ok: true; details: TechnicalDetails; canEdit: boolean; saved: boolean } | { ok: false; message: string }> {
  const r = await demoGet(demoPath("model-technical", applicationId));
  return r.ok ? { ok: true, details: toDetails(r.value), canEdit: Boolean(r.value.canEdit), saved: Boolean(r.value.saved) } : { ok: false, message: r.message };
}

export async function saveTechnicalDetails(applicationId: string, d: TechnicalDetails): Promise<{ ok: true } | { ok: false; message: string }> {
  const body = {
    acType: d.acType || null, compressorType: d.compressorType || null, refrigerant: d.refrigerant || null,
    ratedVoltage: d.ratedVoltage.trim() || null, coolingCapacityW: d.coolingCapacityW.trim() || null, powerInputW: d.powerInputW.trim() || null, testReportNumber: d.testReportNumber.trim() || null,
  };
  const r = await demoPost(demoPath("model-technical", applicationId), body);
  return r.ok ? { ok: true } : { ok: false, message: r.message };
}
