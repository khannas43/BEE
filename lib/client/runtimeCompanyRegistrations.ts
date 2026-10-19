import { runtimeRead, type Read } from "@/lib/client/runtimeHttp";

/** A company registration as the list read returns it (GET /api/runtime/manufacturer-onboarding). Spring scopes the list to the caller. */
export interface CompanyRegistrationItem {
  id: string;
  reference: string;
  legalName: string;
  state: string;
  createdAt: string | null;
}

function asItems(body: unknown): CompanyRegistrationItem[] | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as { items?: unknown }).items)) return null;
  const out: CompanyRegistrationItem[] = [];
  for (const raw of (body as { items: unknown[] }).items) {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.reference !== "string" || typeof r.state !== "string") return null;
    out.push({
      id: r.id,
      reference: r.reference,
      legalName: typeof r.legalName === "string" ? r.legalName : "",
      state: r.state,
      createdAt: typeof r.createdAt === "string" ? r.createdAt : null,
    });
  }
  return out;
}

/** The company registrations the signed-in person may see. A failure is returned, never thrown, so the model list still shows. */
export async function readCompanyRegistrationsAwaitingApproval(
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; items: CompanyRegistrationItem[] } | { ok: false }> {
  const r: Read<CompanyRegistrationItem[]> = await runtimeRead("/api/runtime/manufacturer-onboarding", asItems, fetchImpl);
  return r.ok ? { ok: true, items: r.value } : { ok: false };
}
