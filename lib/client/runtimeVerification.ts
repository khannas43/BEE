/**
 * The public certificate check through the portal (WP09.1c; the owner's assumption D8, not BEE's decision). No sign-in: the browser sends
 * no cookie that matters and the route reads no session. Provisional local demonstration, never a BEE certificate.
 */
export type PublicVerification = {
  registrationId: string;
  manufacturer: string;
  brandName: string;
  modelNumber: string;
  category: string;
  stars: number;
  verifiedIseer: string;
  validFrom: string;
  validTo: string;
  status: "valid" | "expired" | "not_yet_valid";
  localDemoCertificate: true;
};

export type VerificationResult =
  | { outcome: "found"; certificate: PublicVerification }
  | { outcome: "not_found" }
  | { outcome: "empty" }
  | { outcome: "unavailable" };

export const VERIFICATION_PATH = "/api/runtime/verification";
export const verificationPath = (reg: string) => `${VERIFICATION_PATH}?reg=${encodeURIComponent(reg)}`;

const isCertificate = (b: unknown): b is PublicVerification =>
  !!b && typeof b === "object" && typeof (b as PublicVerification).registrationId === "string" && typeof (b as PublicVerification).status === "string" && (b as PublicVerification).localDemoCertificate === true;

export async function readPublicVerification(reg: string, fetchImpl: typeof fetch = fetch): Promise<VerificationResult> {
  const trimmed = reg.trim();
  if (!trimmed) return { outcome: "empty" };
  let res: Response;
  try {
    res = await fetchImpl(verificationPath(trimmed), { cache: "no-store", credentials: "omit" });
  } catch {
    return { outcome: "unavailable" };
  }
  const body = await res.json().catch(() => null);
  if (res.status === 200) return isCertificate(body) ? { outcome: "found", certificate: body } : { outcome: "unavailable" };
  if (res.status === 404) return { outcome: "not_found" };
  if (res.status === 422) return { outcome: "empty" };
  return { outcome: "unavailable" };
}

export const VERIFICATION_COPY = {
  heading: "Verify a BEE registration",
  intro: "Enter the registration ID printed on the certificate or label, or scan its QR code. This is a local demonstration: nothing here is issued by BEE.",
  placeholder: "BEE/RAC/2026/10001",
  statusText: { valid: "Valid registration", expired: "Expired registration", not_yet_valid: "Registration not yet valid" },
  notFound: "No such registration. Check the registration ID against the certificate or label.",
  unavailable: "The check is not available right now. Please try again.",
  empty: "Enter a registration ID.",
  demo: "Local demonstration: this is not a BEE certificate and has no legal effect.",
} as const;
