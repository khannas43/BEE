import type { SopDetails } from "./types";

/** Section 1.1 of the SOP: the Company Registration Form's own options and fees. */
export const REGISTRATION_CHARGE_INR = 5000;
/** The security deposit of a large-scale industry (the SOP names no deposit for a small-scale industry). */
export const SECURITY_DEPOSIT_LARGE_INR = 300000;

export const CATEGORY_OPTIONS: { value: "manufacturer" | "importer"; label: string }[] = [
  { value: "manufacturer", label: "Manufacturer" },
  { value: "importer", label: "Importer" },
];

/** The equipment the portal registers (from the SOP's screens). */
export const EQUIPMENT_OPTIONS = [
  "Room Air Conditioner (Fixed Speed)",
  "Room Air Conditioner (Inverter)",
  "Light Commercial AC (Fixed Speed)",
  "Light Commercial AC (Variable Speed)",
];

export const PAYMENT_METHOD_LABELS = { billdesk: "BillDesk", razorpay: "Razorpay", direct_transfer: "Direct transfer" } as const;
export const TITLE_OPTIONS = ["Mr", "Ms", "Mrs", "Dr", "Shri", "Smt"];
export const ID_PROOF_NOTE = "Aadhaar, passport, driving licence or voter ID";

export function emptySop(): SopDetails {
  return {
    disclaimerAccepted: false,
    category: "",
    scale: "",
    equipment: "",
    brandName: "",
    business: { country: "India", district: "", phoneStd: "", phone: "", mobile: "", faxStd: "", fax: "", website: "", email: "" },
    companyRegNo: "",
    companyRegDate: "",
    companyPan: "",
    annualTurnoverLakhs: "",
    payment: { method: "", status: "", receipt: "", recordedAt: "", transfer: { bank: "", transactionId: "", paymentDate: "", remarks: "" } },
  };
}

/** The fee lines of the registration: the charge, and the security deposit when the company is a large-scale industry. */
export function feeLines(scale: SopDetails["scale"]): { label: string; amountInr: number }[] {
  const lines = [{ label: "Company registration charge", amountInr: REGISTRATION_CHARGE_INR }];
  if (scale === "large") lines.push({ label: "Label security deposit (large-scale industry)", amountInr: SECURITY_DEPOSIT_LARGE_INR });
  return lines;
}

export const feeTotal = (scale: SopDetails["scale"]) => feeLines(scale).reduce((n, l) => n + l.amountInr, 0);
export const inr = (n: number) => `₹ ${n.toLocaleString("en-IN")}`;
