import { type NextRequest } from "next/server";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_FEE_RULE_PROPOSAL } from "@/lib/server/contracts/fee-rules";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const POST = logged("/api/runtime/fee-rules/proposals", async (request: NextRequest) => {
  const body = await request.text();
  return sessionWrite(request, "POST", "/api/fee-rules/proposals", body, SPRING_FEE_RULE_PROPOSAL);
});

export const GET = logged("/api/runtime/fee-rules/proposals", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
