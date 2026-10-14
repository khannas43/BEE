import { type NextRequest } from "next/server";
import { sessionRead, sessionWrite } from "@/lib/server/bff";
import { SPRING_REGISTRATION_CREATE, SPRING_REGISTRATION_LIST } from "@/lib/server/contracts/registrations";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Registration requests this session may read, as decided by Spring. Query parameters are not forwarded. */
export const GET = logged("/api/runtime/registrations", async (request: NextRequest) => {
  return sessionRead(request, "/api/registrations", SPRING_REGISTRATION_LIST);
});

export const POST = logged("/api/runtime/registrations", async (request: NextRequest) => {
  const body = await request.text();
  return sessionWrite(request, "POST", "/api/registrations", body, SPRING_REGISTRATION_CREATE);
});
export const PUT = logged("/api/runtime/registrations", methodNotAllowed("GET, POST"));
export const PATCH = PUT;
export const DELETE = PUT;
