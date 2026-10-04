import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_SECRETARY_APPROVAL } from "@/lib/server/contracts/secretary-approval";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springPath = (id: string) => `/api/model-applications/${springIdSegment(id)}/secretary-approval`;

export const POST = logged("/api/runtime/model-applications/{id}/secretary-approval", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "POST", springPath(id), body, SPRING_SECRETARY_APPROVAL);
});

export const GET = logged("/api/runtime/model-applications/{id}/secretary-approval", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
