import { type NextRequest } from "next/server";
import { sessionRead, sessionWrite } from "@/lib/server/bff";
import { SPRING_REGISTER_REVOCATION_PROPOSE, SPRING_REGISTER_REVOCATIONS } from "@/lib/server/contracts/register-revocations";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/register-revocations", async (request: NextRequest) => sessionRead(request, "/api/register-revocations", SPRING_REGISTER_REVOCATIONS));

export const POST = logged("/api/runtime/register-revocations", async (request: NextRequest) => {
  const body = await request.text();
  return sessionWrite(request, "POST", "/api/register-revocations", body, SPRING_REGISTER_REVOCATION_PROPOSE);
});

export const PUT = logged("/api/runtime/register-revocations", methodNotAllowed("GET, POST"));
export const PATCH = PUT;
export const DELETE = PUT;
