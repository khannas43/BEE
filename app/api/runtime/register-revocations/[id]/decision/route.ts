import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionWrite } from "@/lib/server/bff";
import { SPRING_REGISTER_REVOCATION_DECISION } from "@/lib/server/contracts/register-revocations";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springPath = (id: string) => `/api/register-revocations/${springIdSegment(id)}/decision`;

export const POST = logged("/api/runtime/register-revocations/{id}/decision", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.text();
  return sessionWrite(request, "POST", springPath(id), body, SPRING_REGISTER_REVOCATION_DECISION);
});

export const GET = logged("/api/runtime/register-revocations/{id}/decision", methodNotAllowed("POST"));
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
