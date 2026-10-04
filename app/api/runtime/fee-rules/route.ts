import { type NextRequest } from "next/server";
import { sessionRead } from "@/lib/server/bff";
import { SPRING_FEE_RULES } from "@/lib/server/contracts/fee-rules";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/fee-rules", async (request: NextRequest) => sessionRead(request, "/api/fee-rules", SPRING_FEE_RULES));

export const POST = logged("/api/runtime/fee-rules", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
