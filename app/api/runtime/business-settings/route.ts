import { type NextRequest } from "next/server";
import { sessionRead } from "@/lib/server/bff";
import { SPRING_BUSINESS_SETTINGS } from "@/lib/server/contracts/business-settings";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/business-settings", async (request: NextRequest) => sessionRead(request, "/api/business-settings", SPRING_BUSINESS_SETTINGS));

export const POST = logged("/api/runtime/business-settings", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
