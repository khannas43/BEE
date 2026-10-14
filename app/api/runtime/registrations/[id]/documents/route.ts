import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionRead, sessionWriteMultipart } from "@/lib/server/bff";
import { SPRING_REGISTRATION_DOC_LIST, SPRING_REGISTRATION_DOC_UPLOAD } from "@/lib/server/contracts/registrations";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springDocumentsPath = (id: string) => `/api/registrations/${springIdSegment(id)}/documents`;

export const GET = logged("/api/runtime/registrations/{id}/documents", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionRead(request, springDocumentsPath(id), SPRING_REGISTRATION_DOC_LIST);
});

/** The multipart body is forwarded as received (bytes + Content-Type with boundary); it is never re-encoded. */
export const POST = logged("/api/runtime/registrations/{id}/documents", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionWriteMultipart(request, springDocumentsPath(id), SPRING_REGISTRATION_DOC_UPLOAD);
});

export const PUT = logged("/api/runtime/registrations/{id}/documents", methodNotAllowed("GET, POST"));
export const PATCH = PUT;
export const DELETE = PUT;
