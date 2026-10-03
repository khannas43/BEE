import { type NextRequest } from "next/server";
import { SPRING_DOC_LIST, SPRING_DOC_UPLOAD, springIdSegment } from "@/lib/server/apiContract";
import { sessionRead, sessionWriteMultipart } from "@/lib/server/bff";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springDocumentsPath = (id: string) => `/api/model-applications/${springIdSegment(id)}/documents`;

export const GET = logged("/api/runtime/model-applications/{id}/documents", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionRead(request, springDocumentsPath(id), SPRING_DOC_LIST);
});

/** The multipart body is forwarded as received (bytes + Content-Type with boundary); it is never re-encoded. */
export const POST = logged("/api/runtime/model-applications/{id}/documents", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionWriteMultipart(request, springDocumentsPath(id), SPRING_DOC_UPLOAD);
});

export const PUT = logged("/api/runtime/model-applications/{id}/documents", methodNotAllowed("GET, POST"));
export const PATCH = PUT;
export const DELETE = PUT;
