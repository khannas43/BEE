import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_FEE_CONFIRMATION } from "@/lib/server/contracts/fee-confirmation";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springPath = (id: string) => `/api/model-applications/${springIdSegment(id)}/fee-confirmation`;

export const POST = logged("/api/runtime/model-applications/{id}/fee-confirmation", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "POST", springPath(id), body, SPRING_FEE_CONFIRMATION);
});

export const GET = logged("/api/runtime/model-applications/{id}/fee-confirmation", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
