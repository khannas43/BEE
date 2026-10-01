import { type NextRequest } from "next/server";
import { SPRING_LIST } from "@/lib/server/apiContract";
import { sessionRead } from "@/lib/server/bff";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Model applications this session may read, as decided by Spring. Query parameters are not forwarded. */
export const GET = logged("/api/runtime/model-applications", async (request: NextRequest) => {
  return sessionRead(request, "/api/model-applications", SPRING_LIST);
});

export const POST = logged("/api/runtime/model-applications", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
