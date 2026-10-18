/** Provisional company-registration fee (S&L Manual §4.1, pp. 30–31; assumption A07). */
export const PROVISIONAL_COMPANY_REGISTRATION_FEE_INR = "5000.00";

export const PROVISIONAL_COMPANY_REGISTRATION_FEE_LABEL =
  "Manufacturer entity registration (provisional fee, assumption A07)";

/** Display ₹5,000.00 from the typed amount string. */
export function formatFeeInr(amountInr: string): string {
  const n = Number.parseFloat(amountInr);
  if (Number.isNaN(n)) return amountInr;
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
