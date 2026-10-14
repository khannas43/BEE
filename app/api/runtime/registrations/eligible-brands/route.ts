import { type NextRequest } from "next/server";
import { sessionRead } from "@/lib/server/bff";
import { SPRING_REGISTRATION_BRANDS } from "@/lib/server/contracts/registrations";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/registrations/eligible-brands", async (request: NextRequest) => {
  return sessionRead(request, "/api/registrations/eligible-brands", SPRING_REGISTRATION_BRANDS);
});

export const POST = logged("/api/runtime/registrations/eligible-brands", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
