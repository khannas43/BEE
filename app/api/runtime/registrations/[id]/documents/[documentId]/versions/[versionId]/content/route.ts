import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionReadBinary } from "@/lib/server/bff";
import { SPRING_REGISTRATION_DOC_CONTENT } from "@/lib/server/contracts/registrations";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; documentId: string; versionId: string }> };

export const GET = logged("/api/runtime/registrations/{id}/documents/{documentId}/versions/{versionId}/content", async (request: NextRequest, { params }: Params) => {
  const { id, documentId, versionId } = await params;
  const springPath = `/api/registrations/${springIdSegment(id)}/documents/${springIdSegment(documentId)}/versions/${springIdSegment(versionId)}/content`;
  return sessionReadBinary(request, springPath, SPRING_REGISTRATION_DOC_CONTENT);
});

export const POST = logged("/api/runtime/registrations/{id}/documents/{documentId}/versions/{versionId}/content", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
