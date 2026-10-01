import { type NextRequest } from "next/server";
import { SPRING_PATCH, SPRING_READ, springIdSegment } from "@/lib/server/apiContract";
import { sessionRead, sessionWrite } from "@/lib/server/bff";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * One model application, if Spring lets this session read it. Out-of-scope, unknown,
 * malformed and stale-assignment IDs all get Spring's single 404.
 */
export const GET = logged("/api/runtime/model-applications/{id}", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionRead(request, `/api/model-applications/${springIdSegment(id)}`, SPRING_READ);
});

export const POST = logged("/api/runtime/model-applications/{id}", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = logged("/api/runtime/model-applications/{id}", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "PATCH", `/api/model-applications/${springIdSegment(id)}`, body, SPRING_PATCH);
});
export const DELETE = POST;
