import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE, attemptLogin, newSessionValue, sessionCookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

/** POST { password, code? } → sets a 30-day session cookie. Five wrong tries in a row lock login for 15 minutes. */
export async function POST(req: Request) {
  if (!process.env.APP_PASSWORD) return NextResponse.json({ error: "Login isn't set up (APP_PASSWORD is empty)" }, { status: 400 });
  const { password = "", code = "" } = (await req.json().catch(() => ({}))) as { password?: string; code?: string };
  const r = await attemptLogin(getDb(), String(password), String(code));
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  res.cookies.set(SESSION_COOKIE, newSessionValue(), sessionCookieOptions(secure));
  return res;
}
