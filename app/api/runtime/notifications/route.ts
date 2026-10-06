import { type NextRequest } from "next/server";
import { sessionRead } from "@/lib/server/bff";
import { SPRING_NOTIFICATIONS } from "@/lib/server/contracts/notifications";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = logged("/api/runtime/notifications", async (request: NextRequest) => sessionRead(request, "/api/notifications", SPRING_NOTIFICATIONS));

export const POST = logged("/api/runtime/notifications", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
