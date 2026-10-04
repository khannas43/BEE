import { type NextRequest } from "next/server";
import { SPRING_DOC_CONTENT, springIdSegment } from "@/lib/server/apiContract";
import { sessionReadBinary } from "@/lib/server/bff";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; documentId: string; versionId: string }> };

export const GET = logged("/api/runtime/model-applications/{id}/documents/{documentId}/versions/{versionId}/content", async (request: NextRequest, { params }: Params) => {
  const { id, documentId, versionId } = await params;
  const springPath = `/api/model-applications/${springIdSegment(id)}/documents/${springIdSegment(documentId)}/versions/${springIdSegment(versionId)}/content`;
  return sessionReadBinary(request, springPath, SPRING_DOC_CONTENT);
});

export const POST = logged("/api/runtime/model-applications/{id}/documents/{documentId}/versions/{versionId}/content", methodNotAllowed("GET"));
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
