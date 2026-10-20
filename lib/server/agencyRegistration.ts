import "server-only";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { callBeeApi } from "@/lib/server/beeApi";
import { createGuestIdentity, deleteGuestIdentity, setGuestAccess } from "@/lib/server/keycloakAdmin";
import { passwordGrant } from "@/lib/server/keycloak";
import { toBackendDraft } from "@/lib/manufacturer-onboarding/mapBackend";
import { registrationIssues } from "@/lib/manufacturer-onboarding/validation";
import { EQUIPMENT_OPTIONS, feeLines, feeTotal } from "@/lib/manufacturer-onboarding/sopDefaults";
import { DOCUMENT_KINDS_WITH_VALIDITY, DOCUMENT_KIND_LABELS, REGISTRATION_DOCUMENT_KINDS } from "@/lib/manufacturer-onboarding/documentKinds";
import type { ManufacturerDraft } from "@/lib/manufacturer-onboarding/types";

/**
 * Public agency registration, after section 1.1 of the SOP for the BEE S&L portal (option B): the company registration form is filled without an
 * account and submitted for a Reference ID; the registration charge and security deposit are paid afterwards from "Pay Registration Fee" with the
 * Reference ID, a captcha and a verification code; the sign-in credentials come after the payment. Everything real happens through the existing
 * identity service and API: the identity is created with a password nobody knows and switched off, the form is stored as the draft of an ordinary
 * onboarding application, and the payment finishes the ordinary submit. Local demonstration, nothing is sent; the code and credentials are shown on screen.
 */

const MINUTE = 60_000;
const CODE_LIFE_MS = 3 * MINUTE;
const LOCK_MS = 120 * MINUTE;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE = /^[6-9]\d{9}$/;

export class RegistrationError extends Error {
  constructor(public code: string, public status = 422, public detail?: unknown) {
    super(code);
  }
}

type Pending = {
  reference: string; username: string; keycloakId: string; applicationId: string; email: string; firm: string; equipment: string; scale: "small" | "large";
  createdAt: string; paid: boolean;
};
type Stores = {
  captchas: Map<string, { answer: string; expires: number }>;
  codes: Map<string, { code: string; expires: number; attempts: number; lockedUntil: number }>;
  tokens: Map<string, { reference: string; expires: number }>;
};
const g = globalThis as unknown as { __beeAgency?: Stores };
const stores = (): Stores => (g.__beeAgency ??= { captchas: new Map(), codes: new Map(), tokens: new Map() });

// ---- the pending registrations (survive a restart of the portal) -------------------------------------------------------------

const registryFile = () => path.join(process.cwd(), ".local", "run", "agency-registrations.json");
function readRegistry(): Pending[] {
  try {
    return JSON.parse(fs.readFileSync(registryFile(), "utf8")) as Pending[];
  } catch {
    return [];
  }
}
function writeRegistry(list: Pending[]) {
  fs.mkdirSync(path.dirname(registryFile()), { recursive: true });
  fs.writeFileSync(registryFile(), JSON.stringify(list, null, 2));
}
const findPending = (reference: string) => readRegistry().find((p) => p.reference.toLowerCase() === reference.trim().toLowerCase());
function savePending(p: Pending) {
  writeRegistry([...readRegistry().filter((x) => x.reference !== p.reference), p]);
}

// ---- captcha -------------------------------------------------------------------------------------------------------------------

const CAPTCHA_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export function newCaptcha(): { id: string; image: string } {
  const answer = Array.from({ length: 6 }, () => CAPTCHA_ALPHABET[randomInt(CAPTCHA_ALPHABET.length)]).join("");
  const id = randomUUID();
  const s = stores();
  for (const [k, v] of s.captchas) if (v.expires < Date.now()) s.captchas.delete(k);
  s.captchas.set(id, { answer, expires: Date.now() + 10 * MINUTE });
  const letters = [...answer].map((c, i) => `<text x="${12 + i * 22}" y="${30 + randomInt(-4, 5)}" font-size="${24 + randomInt(-2, 4)}" font-family="monospace" font-weight="bold" fill="#1f3c88" transform="rotate(${randomInt(-14, 15)} ${12 + i * 22} 28)">${c}</text>`).join("");
  const noise = Array.from({ length: 4 }, () => `<line x1="${randomInt(0, 150)}" y1="${randomInt(0, 44)}" x2="${randomInt(0, 150)}" y2="${randomInt(0, 44)}" stroke="#9db4e0" stroke-width="1.2"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="44" viewBox="0 0 150 44"><rect width="150" height="44" fill="#eef3fb"/>${noise}${letters}</svg>`;
  return { id, image: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
}
function checkCaptcha(id: unknown, answer: unknown) {
  const entry = typeof id === "string" ? stores().captchas.get(id) : undefined;
  if (typeof id === "string") stores().captchas.delete(id);
  if (!entry || entry.expires < Date.now() || typeof answer !== "string" || entry.answer.toLowerCase() !== answer.trim().toLowerCase()) throw new RegistrationError("captcha_invalid");
}

// ---- helpers over the API ------------------------------------------------------------------------------------------------------

const randomPassword = () => `${randomBytes(4).toString("hex")}A${randomInt(10, 99)}x`;
const idem = () => randomUUID().replace(/-/g, "").slice(0, 32);

async function api(correlationId: string, method: string, pathName: string, token: string | undefined, body?: object | ArrayBuffer, contentType?: string) {
  return callBeeApi(pathName, {
    correlationId, method, accessToken: token, timeoutMs: 15000,
    ...(body === undefined ? {} : { body: body instanceof ArrayBuffer ? body : JSON.stringify(body), contentType }),
    extraHeaders: method === "GET" ? undefined : { "Idempotency-Key": idem() },
  });
}

async function myApplication(correlationId: string, token: string): Promise<{ id: string; version: number; reference: string; state: string }> {
  const list = await api(correlationId, "GET", "/api/manufacturer-onboarding", token);
  const item = (list.body as { items?: { id: string; version: number; reference: string; state: string }[] } | null)?.items?.[0];
  if (list.status !== 200 || !item) throw new RegistrationError("upstream_failed", 502);
  return item;
}

// ---- 1. the form --------------------------------------------------------------------------------------------------------------

export type RegistrationFiles = Record<string, { file: File; expiresOn?: string }>;

export async function submitRegistration(input: { form: ManufacturerDraft; files: RegistrationFiles; captchaId: unknown; captchaAnswer: unknown; correlationId: string }) {
  const { form, files, correlationId } = input;
  checkCaptcha(input.captchaId, input.captchaAnswer);
  const issues = registrationIssues(form, { paymentRequired: false });
  const asked = REGISTRATION_DOCUMENT_KINDS.filter((k) => k !== "ssi_certificate" || form.sop.scale === "small");
  const missing = asked.filter((k) => !files[k]);
  if (issues.length || missing.length) throw new RegistrationError("validation_failed", 422, { issues, missing });
  const contact = form.contacts[0];
  const email = form.sop.business.email.trim().toLowerCase();
  const mobile = form.sop.business.mobile.trim();
  const fullName = (contact?.name ?? "").trim();
  if (fullName.length < 2 || !EMAIL.test(email) || !MOBILE.test(mobile)) throw new RegistrationError("validation_failed", 422, { issues: ["A valid business email and a 10-digit mobile number are required."] });

  const username = `mfr${randomInt(100000, 999999)}`;
  const password = randomPassword();
  let guest;
  try {
    guest = await createGuestIdentity({ username, email, fullName, password });
  } catch {
    throw new RegistrationError("identity_unavailable", 503);
  }
  if (!guest.ok) throw new RegistrationError("email_in_use", 409);
  try {
    const signup = await api(correlationId, "POST", "/api/public/manufacturer-signup", undefined, { fullName, email, mobile, keycloakSubject: guest.id });
    if (signup.status >= 300) throw new RegistrationError("registration_not_available", 409, { upstream: signup.status, body: signup.body });
    const tokens = await passwordGrant(username, password, correlationId);
    const app = await myApplication(correlationId, tokens.access_token);
    const draft = toBackendDraft(form);
    const patched = await api(correlationId, "PATCH", `/api/manufacturer-onboarding/${app.id}`, tokens.access_token, { version: app.version, legalName: form.legalName.trim(), draft });
    if (patched.status !== 200) throw new RegistrationError("upstream_failed", 502);
    for (const kind of asked) {
      const f = files[kind];
      const out = new FormData();
      out.append("file", f.file);
      out.append("documentKind", kind);
      out.append("label", form.annexureNotes?.[kind]?.trim() || DOCUMENT_KIND_LABELS[kind]);
      if (f.expiresOn && DOCUMENT_KINDS_WITH_VALIDITY.includes(kind)) out.append("expiresOn", f.expiresOn);
      const packed = new Response(out);
      const up = await api(correlationId, "POST", `/api/manufacturer-onboarding/${app.id}/documents`, tokens.access_token, await packed.arrayBuffer(), packed.headers.get("content-type") ?? undefined);
      if (up.status !== 200) throw new RegistrationError("upstream_failed", 502, { kind });
    }
    await setGuestAccess(guest.id, { enabled: false });
    const pending: Pending = {
      reference: app.reference, username, keycloakId: guest.id, applicationId: app.id, email, firm: form.legalName.trim(), equipment: form.sop.equipment,
      scale: form.sop.scale === "small" ? "small" : "large", createdAt: new Date().toISOString(), paid: false,
    };
    savePending(pending);
    return { reference: app.reference, firm: pending.firm, equipment: pending.equipment, email };
  } catch (e) {
    await deleteGuestIdentity(guest.id);
    throw e instanceof RegistrationError ? e : new RegistrationError("identity_unavailable", 503);
  }
}

// ---- 2. pay by Reference ID ------------------------------------------------------------------------------------------------------

export function startPayment(input: { reference: unknown; captchaId: unknown; captchaAnswer: unknown }) {
  checkCaptcha(input.captchaId, input.captchaAnswer);
  const ref = typeof input.reference === "string" ? input.reference.trim() : "";
  const p = ref ? findPending(ref) : undefined;
  if (!p) throw new RegistrationError("reference_not_found", 404);
  if (p.paid) throw new RegistrationError("already_paid", 409);
  const s = stores();
  const prior = s.codes.get(p.reference);
  if (prior && prior.lockedUntil > Date.now()) throw new RegistrationError("locked", 423, { retryAfterMinutes: Math.ceil((prior.lockedUntil - Date.now()) / MINUTE) });
  const code = String(randomInt(100000, 999999));
  s.codes.set(p.reference, { code, expires: Date.now() + CODE_LIFE_MS, attempts: 0, lockedUntil: 0 });
  return { reference: p.reference, code, validSeconds: CODE_LIFE_MS / 1000 };
}

export function verifyCode(input: { reference: unknown; code: unknown }) {
  const p = typeof input.reference === "string" ? findPending(input.reference) : undefined;
  if (!p) throw new RegistrationError("reference_not_found", 404);
  const s = stores();
  const entry = s.codes.get(p.reference);
  if (!entry) throw new RegistrationError("code_expired", 410);
  if (entry.lockedUntil > Date.now()) throw new RegistrationError("locked", 423, { retryAfterMinutes: Math.ceil((entry.lockedUntil - Date.now()) / MINUTE) });
  if (entry.expires < Date.now()) {
    s.codes.delete(p.reference);
    throw new RegistrationError("code_expired", 410);
  }
  if (typeof input.code !== "string" || input.code.trim() !== entry.code) {
    entry.attempts += 1;
    if (entry.attempts >= 3) {
      entry.lockedUntil = Date.now() + LOCK_MS;
      throw new RegistrationError("locked", 423, { retryAfterMinutes: LOCK_MS / MINUTE });
    }
    throw new RegistrationError("code_invalid", 422, { attemptsLeft: 3 - entry.attempts });
  }
  s.codes.delete(p.reference);
  const token = randomUUID();
  s.tokens.set(token, { reference: p.reference, expires: Date.now() + 15 * MINUTE });
  const lines = feeLines(p.scale);
  return { payToken: token, reference: p.reference, firm: p.firm, equipment: p.equipment || EQUIPMENT_OPTIONS[0], scale: p.scale, lines, total: feeTotal(p.scale), methods: ["billdesk", "razorpay", "direct_transfer"] };
}

// ---- 3. the payment and the credentials -------------------------------------------------------------------------------------------

export async function confirmPayment(input: { payToken: unknown; method: unknown; outcome: unknown; transfer: unknown; correlationId: string }) {
  const s = stores();
  const t = typeof input.payToken === "string" ? s.tokens.get(input.payToken) : undefined;
  if (!t || t.expires < Date.now()) throw new RegistrationError("token_expired", 410);
  const p = findPending(t.reference);
  if (!p) throw new RegistrationError("reference_not_found", 404);
  if (p.paid) throw new RegistrationError("already_paid", 409);
  const method = input.method;
  if (method !== "billdesk" && method !== "razorpay" && method !== "direct_transfer") throw new RegistrationError("validation_failed");
  const tr = (input.transfer ?? {}) as Record<string, unknown>;
  const transfer = { bank: String(tr.bank ?? ""), transactionId: String(tr.transactionId ?? ""), paymentDate: String(tr.paymentDate ?? ""), remarks: String(tr.remarks ?? "") };
  if (method === "direct_transfer" && (!transfer.bank || !transfer.transactionId.trim() || !transfer.paymentDate)) throw new RegistrationError("validation_failed", 422, { issues: ["Bank, transaction ID and payment date are required."] });
  if (method !== "direct_transfer" && input.outcome === "failed") return { status: "failed" as const, reference: p.reference };

  const { correlationId } = input;
  const password = randomPassword();
  try {
    await setGuestAccess(p.keycloakId, { enabled: true, password });
  } catch {
    throw new RegistrationError("identity_unavailable", 503);
  }
  const tokens = await passwordGrant(p.username, password, correlationId);
  const token = tokens.access_token;
  const detail = await api(correlationId, "GET", `/api/manufacturer-onboarding/${p.applicationId}`, token);
  const body = detail.body as { version: number; draft?: { sop?: Record<string, unknown> } } | null;
  if (detail.status !== 200 || !body) throw new RegistrationError("upstream_failed", 502);
  const receipt = `${method === "direct_transfer" ? "TRF" : method === "billdesk" ? "SIM-BD" : "SIM-RP"}-${randomInt(1000000, 9999999)}`;
  const payment = { method, status: method === "direct_transfer" ? "awaiting_confirmation" : "paid", receipt, recordedAt: new Date().toISOString(), transfer };
  const patched = await api(correlationId, "PATCH", `/api/manufacturer-onboarding/${p.applicationId}`, token, { version: body.version, draft: { sop: { ...(body.draft?.sop ?? {}), payment } } });
  const version = (patched.body as { version?: number } | null)?.version;
  if (patched.status !== 200 || typeof version !== "number") throw new RegistrationError("upstream_failed", 502);
  const submit = await api(correlationId, "POST", `/api/manufacturer-onboarding/${p.applicationId}/submit`, token, { version });
  const after = await api(correlationId, "GET", `/api/manufacturer-onboarding/${p.applicationId}`, token);
  const out = after.body as { state?: string; payment?: { receiptNumber?: string; amountInr?: string }; automatedChecks?: { checkCode: string; outcome: string; detail?: string | null }[] } | null;
  const credentials = { username: p.username, password };
  if (submit.status >= 300 || !out || out.state === "automatic_checks_failed" || out.state === "draft") {
    const failed = (out?.automatedChecks ?? []).filter((c) => c.outcome === "fail").map((c) => `${c.checkCode}${c.detail ? `: ${c.detail}` : ""}`);
    return { status: "checks_failed" as const, reference: p.reference, failed, credentials };
  }
  savePending({ ...p, paid: true });
  s.tokens.delete(String(input.payToken));
  return {
    status: payment.status as "paid" | "awaiting_confirmation", reference: p.reference, email: p.email, firm: p.firm, method, depositReceipt: receipt,
    chargeReceipt: out.payment?.receiptNumber ?? "", chargeInr: out.payment?.amountInr ?? "5000.00", total: feeTotal(p.scale), lines: feeLines(p.scale), credentials,
  };
}
