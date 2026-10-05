import { type NextRequest } from "next/server";
import { sessionRead } from "@/lib/server/bff";
import { SPRING_RATING_SCHEMES } from "@/lib/server/contracts/rating-schemes";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/rating-schemes", async (request: NextRequest) => sessionRead(request, "/api/rating-schemes", SPRING_RATING_SCHEMES));

export const POST = logged("/api/runtime/rating-schemes", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
