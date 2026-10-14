import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionRead, sessionWrite } from "@/lib/server/bff";
import { SPRING_REGISTRATION_PREVIEW, SPRING_REGISTRATION_SUBMIT } from "@/lib/server/contracts/registrations";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springSubmitPath = (id: string) => `/api/registrations/${springIdSegment(id)}/submit`;

export const GET = logged("/api/runtime/registrations/{id}/submit", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionRead(request, springSubmitPath(id), SPRING_REGISTRATION_PREVIEW);
});

export const POST = logged("/api/runtime/registrations/{id}/submit", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "POST", springSubmitPath(id), body, SPRING_REGISTRATION_SUBMIT);
});

export const PUT = logged("/api/runtime/registrations/{id}/submit", methodNotAllowed("GET, POST"));
export const PATCH = PUT;
export const DELETE = PUT;
