import { type NextRequest } from "next/server";
import { sessionDemo } from "@/lib/server/bff";
import { logged } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Demonstration areas (payments, QR, ledger, production, MIS, AI). Passes GET and POST to Spring's /api/demo/** with the signed-in
 * session; Spring decides who may do what. Outside the documented contract on purpose (BL-220).
 */
const target = (request: NextRequest, path: string[]) => `/api/demo/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;

export const GET = logged("/api/runtime/demo", async (request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => {
  const { path } = await ctx.params;
  return sessionDemo(request, "GET", target(request, path));
});

export const POST = logged("/api/runtime/demo", async (request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => {
  const { path } = await ctx.params;
  return sessionDemo(request, "POST", target(request, path), await request.text());
});

export const PUT = logged("/api/runtime/demo", async () => new Response(JSON.stringify({ error: "denied_by_default" }), { status: 405, headers: { "Content-Type": "application/json", Allow: "GET, POST" } }));
export const PATCH = PUT;
export const DELETE = PUT;
