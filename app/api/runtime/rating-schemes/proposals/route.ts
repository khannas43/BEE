import { type NextRequest } from "next/server";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_RATING_SCHEME_PROPOSAL } from "@/lib/server/contracts/rating-schemes";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const POST = logged("/api/runtime/rating-schemes/proposals", async (request: NextRequest) => {
  const body = await request.text();
  return sessionWrite(request, "POST", "/api/rating-schemes/proposals", body, SPRING_RATING_SCHEME_PROPOSAL);
});

export const GET = logged("/api/runtime/rating-schemes/proposals", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
