import { type NextRequest } from "next/server";
import { SPRING_ELIGIBLE_BRANDS } from "@/lib/server/apiContract";
import { sessionRead } from "@/lib/server/bff";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/model-applications/eligible-brands", async (request: NextRequest) => {
  return sessionRead(request, "/api/model-applications/eligible-brands", SPRING_ELIGIBLE_BRANDS);
});

export const POST = logged("/api/runtime/model-applications/eligible-brands", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
