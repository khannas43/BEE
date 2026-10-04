import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionRead } from "@/lib/server/bff";
import { SPRING_HISTORY } from "@/lib/server/contracts/history";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springPath = (id: string) => `/api/model-applications/${springIdSegment(id)}/history`;

export const GET = logged("/api/runtime/model-applications/{id}/history", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionRead(request, springPath(id), SPRING_HISTORY);
});

export const POST = logged("/api/runtime/model-applications/{id}/history", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
