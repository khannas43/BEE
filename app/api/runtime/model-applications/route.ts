import { type NextRequest } from "next/server";
import { SPRING_CREATE, SPRING_LIST } from "@/lib/server/apiContract";
import { sessionRead, sessionWrite } from "@/lib/server/bff";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Model applications this session may read, as decided by Spring. Query parameters are not forwarded. */
export const GET = logged("/api/runtime/model-applications", async (request: NextRequest) => {
  return sessionRead(request, "/api/model-applications", SPRING_LIST);
});

export const POST = logged("/api/runtime/model-applications", async (request: NextRequest) => {
  const body = await request.text();
  return sessionWrite(request, "POST", "/api/model-applications", body, SPRING_CREATE);
});
export const PUT = logged("/api/runtime/model-applications", methodNotAllowed("GET, POST"));
export const PATCH = PUT;
export const DELETE = PUT;
