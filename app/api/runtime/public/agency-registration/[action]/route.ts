import { type NextRequest, NextResponse } from "next/server";
import { correlationIdOf, logged, withContractHeaders } from "@/lib/server/http";
import { RateLimiter } from "@/lib/server/rateLimit";
import { confirmPayment, newCaptcha, RegistrationError, startPayment, submitRegistration, verifyCode, type RegistrationFiles } from "@/lib/server/agencyRegistration";
import type { ManufacturerDraft } from "@/lib/manufacturer-onboarding/types";

export const dynamic = "force-dynamic";

/** Public agency registration (SOP section 1.1, option B). See lib/server/agencyRegistration.ts. Local demonstration. */
const LIMIT = new RateLimiter(60);

function json(body: object, status: number, correlationId: string) {
  return withContractHeaders(NextResponse.json(body, { status }), correlationId);
}

async function handle(request: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const correlationId = correlationIdOf(request);
  const { action } = await ctx.params;
  if (!LIMIT.check("all").allowed) return json({ error: "rate_limited", message: "Too many requests. Wait a moment and try again." }, 429, correlationId);
  try {
    if (action === "captcha" && request.method === "GET") return json(newCaptcha(), 200, correlationId);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, correlationId);
    if (action === "submit") {
      const form = await request.formData();
      const draft = JSON.parse(String(form.get("draft") ?? "null")) as ManufacturerDraft | null;
      if (!draft) throw new RegistrationError("validation_failed");
      const expiry = JSON.parse(String(form.get("expiry") ?? "{}")) as Record<string, string>;
      const files: RegistrationFiles = {};
      for (const [key, value] of form.entries()) {
        if (key.startsWith("file:") && typeof value !== "string") files[key.slice(5)] = { file: value, expiresOn: expiry[key.slice(5)] || undefined };
      }
      const out = await submitRegistration({ form: draft, files, captchaId: form.get("captchaId"), captchaAnswer: form.get("captchaAnswer"), correlationId });
      return json(out, 201, correlationId);
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (action === "pay-start") return json(startPayment({ reference: body.reference, captchaId: body.captchaId, captchaAnswer: body.captchaAnswer }), 200, correlationId);
    if (action === "pay-verify") return json(verifyCode({ reference: body.reference, code: body.code }), 200, correlationId);
    if (action === "pay-confirm") return json(await confirmPayment({ payToken: body.payToken, method: body.method, outcome: body.outcome, transfer: body.transfer, correlationId }), 200, correlationId);
    return json({ error: "not_found" }, 404, correlationId);
  } catch (e) {
    if (e instanceof RegistrationError) return json({ error: e.code, detail: e.detail ?? null }, e.status, correlationId);
    return json({ error: "upstream_failed" }, 502, correlationId);
  }
}

export const GET = logged("/api/runtime/public/agency-registration", handle);
export const POST = GET;
