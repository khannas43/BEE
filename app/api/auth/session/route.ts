import { type NextRequest, NextResponse } from "next/server";
import { publicView, readSession, sessionCookieOf } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Whether this browser has a server session. Never returns tokens. */
export async function GET(request: NextRequest) {
  const session = readSession(sessionCookieOf(request));
  return NextResponse.json(session ? publicView(session) : { authenticated: false }, { headers: { "Cache-Control": "no-store" } });
}
