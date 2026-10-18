import { type NextRequest } from "next/server";
import { springIdSegment } from "@/lib/server/apiContract";
import { sessionRead, sessionWriteMultipart } from "@/lib/server/bff";
import {
  SPRING_MANUFACTURER_ONBOARDING_DOC_LIST,
  SPRING_MANUFACTURER_ONBOARDING_DOC_UPLOAD,
} from "@/lib/server/contracts/manufacturer-onboarding";
import { logged, methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const springDocumentsPath = (id: string) => `/api/manufacturer-onboarding/${springIdSegment(id)}/documents`;

export const GET = logged("/api/runtime/manufacturer-onboarding/{id}/documents", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionRead(request, springDocumentsPath(id), SPRING_MANUFACTURER_ONBOARDING_DOC_LIST);
});

export const POST = logged("/api/runtime/manufacturer-onboarding/{id}/documents", async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  return sessionWriteMultipart(request, springDocumentsPath(id), SPRING_MANUFACTURER_ONBOARDING_DOC_UPLOAD);
});

export const PUT = logged("/api/runtime/manufacturer-onboarding/{id}/documents", methodNotAllowed("GET, POST"));
export const PATCH = PUT;
export const DELETE = PUT;
