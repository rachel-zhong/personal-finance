import { NextRequest, NextResponse } from "next/server";

/**
 * Local-only guard: API calls that change data must come from this app's own pages.
 * Blocks other websites in your browser from POSTing to localhost (CSRF).
 */
export function middleware(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return NextResponse.next();
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || new URL(origin).host !== host) {
    return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
