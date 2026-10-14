import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionRead, sessionWrite } from "@/lib/server/bff";
import { SPRING_REGISTRATION_PATCH, SPRING_REGISTRATION_READ } from "@/lib/server/contracts/registrations";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** One registration request, if Spring lets this session read it. Out-of-scope, unknown and malformed IDs all get Spring's single 404. */
export const GET = logged("/api/runtime/registrations/{id}", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionRead(request, `/api/registrations/${springIdSegment(id)}`, SPRING_REGISTRATION_READ);
});

export const POST = logged("/api/runtime/registrations/{id}", methodNotAllowed("GET, PATCH"));
export const PUT = POST;
export const PATCH = logged("/api/runtime/registrations/{id}", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "PATCH", `/api/registrations/${springIdSegment(id)}`, body, SPRING_REGISTRATION_PATCH);
});
export const DELETE = POST;
