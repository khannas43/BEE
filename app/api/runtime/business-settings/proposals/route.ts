import { type NextRequest } from "next/server";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_BUSINESS_SETTING_PROPOSAL } from "@/lib/server/contracts/business-settings";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const POST = logged("/api/runtime/business-settings/proposals", async (request: NextRequest) => {
  const body = await request.text();
  return sessionWrite(request, "POST", "/api/business-settings/proposals", body, SPRING_BUSINESS_SETTING_PROPOSAL);
});

export const GET = logged("/api/runtime/business-settings/proposals", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
