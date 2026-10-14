import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_REGISTRATION_TRANSITION } from "@/lib/server/contracts/registrations";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springPath = (id: string) => `/api/registrations/${springIdSegment(id)}/transition`;

export const POST = logged("/api/runtime/registrations/{id}/transition", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "POST", springPath(id), body, SPRING_REGISTRATION_TRANSITION);
});

export const GET = logged("/api/runtime/registrations/{id}/transition", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
