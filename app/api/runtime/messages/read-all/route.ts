import { type NextRequest } from "next/server";
import { sessionAction } from "@/lib/server/bff";
import { SPRING_MESSAGE_READ_ALL } from "@/lib/server/contracts/messages";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const POST = logged("/api/runtime/messages/read-all", async (request: NextRequest) => sessionAction(request, "/api/messages/read-all", SPRING_MESSAGE_READ_ALL));

export const GET = logged("/api/runtime/messages/read-all", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
