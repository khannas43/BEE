import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_IAME_RECOMMENDATION } from "@/lib/server/contracts/iame-recommendation";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springPath = (id: string) => `/api/model-applications/${springIdSegment(id)}/iame-recommendation`;

export const POST = logged("/api/runtime/model-applications/{id}/iame-recommendation", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "POST", springPath(id), body, SPRING_IAME_RECOMMENDATION);
});

export const GET = logged("/api/runtime/model-applications/{id}/iame-recommendation", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
