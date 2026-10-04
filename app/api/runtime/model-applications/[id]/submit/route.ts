import { type NextRequest } from "next/server";
import { SPRING_SUBMIT, SPRING_SUBMIT_PREVIEW, springIdSegment } from "@/lib/server/apiContract";
import { sessionRead, sessionWrite } from "@/lib/server/bff";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springSubmitPath = (id: string) => `/api/model-applications/${springIdSegment(id)}/submit`;

export const GET = logged("/api/runtime/model-applications/{id}/submit", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionRead(request, springSubmitPath(id), SPRING_SUBMIT_PREVIEW);
});

export const POST = logged("/api/runtime/model-applications/{id}/submit", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "POST", springSubmitPath(id), body, SPRING_SUBMIT);
});

export const PUT = logged("/api/runtime/model-applications/{id}/submit", methodNotAllowed("GET"));
export const PATCH = PUT;
export const DELETE = PUT;
