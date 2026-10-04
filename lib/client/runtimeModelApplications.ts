/**
 * Browser reads of model applications through the Next.js BFF (WP05.1a).
 * Spring alone decides scope; this module never filters by organisation or role.
 * The browser sends only the httpOnly session cookie — never an Authorization header.
 */

export const MODEL_STATES = [
  "draft",
  "fee_due",
  "iame_scrutiny",
  "bee_scrutiny",
  "rating",
  "director_review",
  "secretary_approval",
  "approved",
  "returned",
  "rejected",
] as const;

export type ModelState = (typeof MODEL_STATES)[number];

export interface ModelApplication {
  id: string;
  reference: string;
  organisation: string;
  brandName: string;
  category: string;
  modelNumber: string;
  state: ModelState;
  version: number;
  readBasis: string[];
  brandId?: string;
  principalOrganisation?: string;
  /** WP05.1d evidence fields; present once the applicant has entered them. */
  laboratoryCode?: string;
  testedOn?: string;
  declaredIseer?: number;
  /** The provisional fee captured at submit; present once the application has been submitted. */
  submissionFee?: {
    amountInr: string;
    currency: string;
    label: string;
    feeRuleKey: string;
    feeRuleVersion: number;
    verificationStatus: string;
    localDemoFee: boolean;
  };
  /** The latest rating record, on the detail read once Programme has rated it. A local demonstration, never a BEE rating. */
  rating?: {
    ratingVersion: number;
    schemeKey: string;
    declaredIseer: string;
    verifiedIseer: string;
    stars: number;
    localDemoRating: true;
    computedAt: string;
  };
}

export interface ModelApplicationList {
  items: ModelApplication[];
  count: number;
  authority: "spring-database";
}

import {
  type FetchLike,
  type ReadFailure,
  RUNTIME_MESSAGES,
  runtimeRead,
  runtimeReadInit,
} from "@/lib/client/runtimeHttp";

// Transport, failure mapping and fixed messages live in the screen kit (runtimeHttp.ts); re-exported so existing imports keep working.
export { runtimeReadInit };
export type { ForbiddenDenial, ReadFailure, SessionDenial } from "@/lib/client/runtimeHttp";

/** Fixed client-safe messages (same strings as the BFF contract) plus this screen's own copy. */
export const READ_UI_MESSAGES = {
  ...RUNTIME_MESSAGES,
  empty_list: "No model applications are available to you.",
  loading: "Loading model applications…",
  loading_detail: "Loading application…",
} as const;

export type ListRead =
  | { ok: true; list: ModelApplicationList }
  | { ok: false; failure: ReadFailure };

export type DetailRead =
  | { ok: true; application: ModelApplication }
  | { ok: false; failure: ReadFailure };

const LIST_PATH = "/api/runtime/model-applications";
const detailPath = (id: string) => `/api/runtime/model-applications/${encodeURIComponent(id)}`;

function asList(body: unknown): ModelApplicationList | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.authority !== "spring-database" || !Array.isArray(b.items) || typeof b.count !== "number") return null;
  return body as ModelApplicationList;
}

function asApplication(body: unknown): ModelApplication | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || typeof b.reference !== "string") return null;
  return body as ModelApplication;
}

/** GET /api/runtime/model-applications — scope is whatever Spring returned. */
export async function readModelApplicationList(fetchImpl: FetchLike = fetch): Promise<ListRead> {
  const r = await runtimeRead(LIST_PATH, asList, fetchImpl);
  return r.ok ? { ok: true, list: r.value } : r;
}

/**
 * GET /api/runtime/model-applications/{id}.
 * Out-of-scope and unknown IDs share one not_found failure; the UI must not distinguish them.
 */
export async function readModelApplication(id: string, fetchImpl: FetchLike = fetch): Promise<DetailRead> {
  const r = await runtimeRead(detailPath(id), asApplication, fetchImpl);
  return r.ok ? { ok: true, application: r.value } : r;
}

/** Build the same-route detail URL; selection is a query parameter only. */
export function modelDashboardHref(id?: string | null): string {
  if (!id) return "/app/model-label/model-dashboard";
  return `/app/model-label/model-dashboard?id=${encodeURIComponent(id)}`;
}

export function stateLabel(state: string): string {
  return state.replaceAll("_", " ");
}
