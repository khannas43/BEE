import { type NextRequest } from "next/server";
import { sessionRead, sessionWrite } from "@/lib/server/bff";
import {
  SPRING_MANUFACTURER_ONBOARDING_CREATE,
  SPRING_MANUFACTURER_ONBOARDING_LIST,
  SPRING_MANUFACTURER_ONBOARDING_READ,
} from "@/lib/server/contracts/manufacturer-onboarding";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/manufacturer-onboarding", async (request: NextRequest) => {
  return sessionRead(request, "/api/manufacturer-onboarding", SPRING_MANUFACTURER_ONBOARDING_LIST);
});

export const POST = logged("/api/runtime/manufacturer-onboarding", async (request: NextRequest) => {
  const body = await request.text();
  return sessionWrite(request, "POST", "/api/manufacturer-onboarding", body, SPRING_MANUFACTURER_ONBOARDING_CREATE);
});

export const PUT = logged("/api/runtime/manufacturer-onboarding", methodNotAllowed("GET, POST"));
export const PATCH = PUT;
export const DELETE = PUT;
