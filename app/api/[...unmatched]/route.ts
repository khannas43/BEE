import { correlationIdOf, errorResponse } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Any /api path without its own route gets the contract's 404, not the HTML page. */
const notFound = (request: Request) => errorResponse("not_found", 404, correlationIdOf(request));

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
