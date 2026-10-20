import type { ManufacturerDraft } from "@/lib/manufacturer-onboarding/types";

/** Browser side of the public agency registration (option B). Local demonstration. */
const BASE = "/api/runtime/public/agency-registration";

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string; detail: Record<string, unknown> | null };

async function call<T>(action: string, init?: RequestInit): Promise<Outcome<T>> {
  try {
    const res = await fetch(`${BASE}/${action}`, { cache: "no-store", credentials: "include", ...init });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String(body.error ?? "upstream_failed"), detail: (body.detail as Record<string, unknown> | null) ?? null };
    return { ok: true, value: body as T };
  } catch {
    return { ok: false, error: "network", detail: null };
  }
}
const post = <T,>(action: string, body: object) => call<T>(action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type Captcha = { id: string; image: string };
export const getCaptcha = () => call<Captcha>("captcha");

export type Submitted = { reference: string; firm: string; equipment: string; email: string };
export function submitForm(draft: ManufacturerDraft, files: Record<string, File>, expiry: Record<string, string>, captcha: { id: string; answer: string }) {
  const form = new FormData();
  form.append("draft", JSON.stringify(draft));
  form.append("expiry", JSON.stringify(expiry));
  form.append("captchaId", captcha.id);
  form.append("captchaAnswer", captcha.answer);
  for (const [kind, file] of Object.entries(files)) form.append(`file:${kind}`, file);
  return call<Submitted>("submit", { method: "POST", body: form });
}

export type FeeLine = { label: string; amountInr: number };
export const startPay = (reference: string, captcha: { id: string; answer: string }) =>
  post<{ reference: string; code: string; validSeconds: number }>("pay-start", { reference, captchaId: captcha.id, captchaAnswer: captcha.answer });
export const verifyPay = (reference: string, code: string) =>
  post<{ payToken: string; reference: string; firm: string; equipment: string; scale: "small" | "large"; lines: FeeLine[]; total: number; methods: string[] }>("pay-verify", { reference, code });

export type PayResult =
  | { status: "failed"; reference: string }
  | { status: "checks_failed"; reference: string; failed: string[]; credentials: { username: string; password: string } }
  | { status: "paid" | "awaiting_confirmation"; reference: string; email: string; firm: string; method: string; depositReceipt: string; chargeReceipt: string; chargeInr: string; total: number; lines: FeeLine[]; credentials: { username: string; password: string } };
export const confirmPay = (payToken: string, method: string, outcome: "success" | "failed", transfer?: object) => post<PayResult>("pay-confirm", { payToken, method, outcome, transfer });

export const ERROR_TEXT: Record<string, string> = {
  captcha_invalid: "The characters in the picture do not match. Try the new picture.",
  reference_not_found: "No registration found for this Reference ID.",
  already_paid: "The registration fee for this Reference ID is already paid.",
  locked: "Too many wrong codes. This Reference ID is locked for 2 hours.",
  code_invalid: "That code is not correct.",
  code_expired: "The code has expired. Start again to get a new one.",
  token_expired: "This payment session has expired. Start again.",
  email_in_use: "This email is already registered.",
  validation_failed: "Some details are missing or not valid.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  identity_unavailable: "The sign-in service is not reachable. Try again later.",
  network: "The portal could not be reached.",
};
export const errorText = (e: string) => ERROR_TEXT[e] ?? "The BEE service returned an unexpected response.";
