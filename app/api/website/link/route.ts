import { NextResponse } from "next/server";
import { isHosted } from "@/lib/hosted";
import { forgetLink, setLink } from "@/lib/website-link";

export const runtime = "nodejs";

const macOnly = () => NextResponse.json({ error: "This is set up in the app on your Mac" }, { status: 403 });

/** Mac only. POST { url, newCode? } saves the website address (and makes a link code); DELETE forgets it. */
export async function POST(req: Request) {
  if (isHosted()) return macOnly();
  const { url, newCode } = (await req.json().catch(() => ({}))) as { url?: string; newCode?: boolean };
  try {
    const l = setLink(String(url ?? ""), !!newCode);
    return NextResponse.json({ url: l.url, token: l.token });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message === "Invalid URL" ? "That doesn't look like a web address" : (e as Error).message }, { status: 400 });
  }
}

export async function DELETE() {
  if (isHosted()) return macOnly();
  forgetLink();
  return NextResponse.json({ ok: true });
}
