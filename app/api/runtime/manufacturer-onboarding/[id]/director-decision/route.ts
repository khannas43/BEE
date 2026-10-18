import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_MANUFACTURER_ONBOARDING_DIRECTOR_DECISION } from "@/lib/server/contracts/manufacturer-onboarding";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springPath = (id: string) => `/api/manufacturer-onboarding/${springIdSegment(id)}/director-decision`;

export const POST = logged("/api/runtime/manufacturer-onboarding/{id}/director-decision", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "POST", springPath(id), body, SPRING_MANUFACTURER_ONBOARDING_DIRECTOR_DECISION);
});

export const GET = logged("/api/runtime/manufacturer-onboarding/{id}/director-decision", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
