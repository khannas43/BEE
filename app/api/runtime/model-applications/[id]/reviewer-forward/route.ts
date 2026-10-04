import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_REVIEWER_FORWARD } from "@/lib/server/contracts/reviewer-forward";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springPath = (id: string) => `/api/model-applications/${springIdSegment(id)}/reviewer-forward`;

export const POST = logged("/api/runtime/model-applications/{id}/reviewer-forward", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "POST", springPath(id), body, SPRING_REVIEWER_FORWARD);
});

export const GET = logged("/api/runtime/model-applications/{id}/reviewer-forward", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
