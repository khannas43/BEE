import { type NextRequest } from "next/server";
import { publicRead } from "@/lib/server/bff";
import { SPRING_PUBLIC_VERIFICATION } from "@/lib/server/contracts/verification";
import { correlationIdOf, errorResponse, logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** The longest registration ID we pass on: the real ones are about 20 characters, and nothing longer can match. */
const MAX_REG_LENGTH = 40;

export const GET = logged("/api/runtime/verification", async (request: NextRequest) => {
  const reg = request.nextUrl.searchParams.get("reg");
  if (reg === null || reg.trim() === "") return errorResponse("validation_failed", 422, correlationIdOf(request));
  // Too long to be a registration ID: the same answer as one that does not exist, without sending it on.
  if (reg.length > MAX_REG_LENGTH) return errorResponse("not_found", 404, correlationIdOf(request));
  return publicRead(request, `/api/public/verification?reg=${encodeURIComponent(reg.trim())}`, SPRING_PUBLIC_VERIFICATION);
});

export const POST = logged("/api/runtime/verification", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
