import { type NextRequest } from "next/server";
import { sessionRead, sessionWrite } from "@/lib/server/bff";
import { SPRING_DELEGATION_PROPOSE, SPRING_DELEGATIONS } from "@/lib/server/contracts/delegations";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/delegations", async (request: NextRequest) => sessionRead(request, "/api/delegations", SPRING_DELEGATIONS));

export const POST = logged("/api/runtime/delegations", async (request: NextRequest) => {
  const body = await request.text();
  return sessionWrite(request, "POST", "/api/delegations", body, SPRING_DELEGATION_PROPOSE);
});

export const PUT = logged("/api/runtime/delegations", methodNotAllowed("GET, POST"));
export const PATCH = PUT;
export const DELETE = PUT;
