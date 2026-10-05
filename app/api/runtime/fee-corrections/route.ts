import { type NextRequest } from "next/server";
import { sessionRead } from "@/lib/server/bff";
import { SPRING_FEE_CORRECTIONS } from "@/lib/server/contracts/fee-corrections";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/fee-corrections", async (request: NextRequest) => sessionRead(request, "/api/fee-corrections", SPRING_FEE_CORRECTIONS));

export const POST = logged("/api/runtime/fee-corrections", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
