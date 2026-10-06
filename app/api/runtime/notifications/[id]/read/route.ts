import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionAction } from "@/lib/server/bff";
import { SPRING_NOTIFICATION_READ } from "@/lib/server/contracts/notifications";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const POST = logged("/api/runtime/notifications/{id}/read", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionAction(request, `/api/notifications/${springIdSegment(id)}/read`, SPRING_NOTIFICATION_READ);
});

export const GET = logged("/api/runtime/notifications/{id}/read", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
