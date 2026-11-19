import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isHosted } from "@/lib/hosted";
import { sendPay } from "@/lib/website-link";

export const runtime = "nodejs";

/** Mac only: send pay numbers (never PDFs) to the linked website now. */
export async function POST() {
  if (isHosted()) return NextResponse.json({ error: "This runs from the app on your Mac" }, { status: 403 });
  const r = await sendPay(getDb());
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
