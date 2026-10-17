import { type NextRequest } from "next/server";
import { sessionRead } from "@/lib/server/bff";
import { SPRING_MESSAGES } from "@/lib/server/contracts/messages";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/messages", async (request: NextRequest) => sessionRead(request, "/api/messages", SPRING_MESSAGES));

export const POST = logged("/api/runtime/messages", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
