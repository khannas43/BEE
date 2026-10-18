import { type NextRequest } from "next/server";
import { sessionRead, sessionWrite } from "@/lib/server/bff";
import {
  SPRING_MANUFACTURER_ONBOARDING_PATCH,
  SPRING_MANUFACTURER_ONBOARDING_READ,
} from "@/lib/server/contracts/manufacturer-onboarding";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/manufacturer-onboarding/{id}", async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return sessionRead(request, `/api/manufacturer-onboarding/${id}`, SPRING_MANUFACTURER_ONBOARDING_READ);
});

export const PATCH = logged("/api/runtime/manufacturer-onboarding/{id}", async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const body = await request.text();
  return sessionWrite(request, "PATCH", `/api/manufacturer-onboarding/${id}`, body, SPRING_MANUFACTURER_ONBOARDING_PATCH);
});

export const POST = logged("/api/runtime/manufacturer-onboarding/{id}", methodNotAllowed("GET, PATCH"));
export const PUT = POST;
export const DELETE = POST;
