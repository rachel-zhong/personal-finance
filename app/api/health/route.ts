import { NextResponse } from "next/server";

/** Railway's health check: says the server is up. Reveals nothing else. */
export function GET() {
  return NextResponse.json({ ok: true });
}
