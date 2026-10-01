import { type NextRequest } from "next/server";
import { SPRING_READ, springIdSegment } from "@/lib/server/apiContract";
import { sessionRead } from "@/lib/server/bff";
import { methodNotAllowed } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * One model application, if Spring lets this session read it. Out-of-scope, unknown,
 * malformed and stale-assignment IDs all get Spring's single 404.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return sessionRead(request, `/api/model-applications/${springIdSegment(id)}`, SPRING_READ);
}

export const POST = methodNotAllowed("GET");
export const PUT = POST;
export const PATCH = POST;
export const DELETE = POST;
