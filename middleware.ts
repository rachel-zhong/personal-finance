import { NextRequest, NextResponse } from "next/server";

/**
 * Guard for API calls that change data: they must come from this app's own pages.
 * Blocks other websites open in your browser from POSTing to the app (CSRF).
 *
 * Reached from your iPhone over Tailscale, the page lives at https://<your-mac>.<tailnet>.ts.net and
 * `tailscale serve` forwards to 127.0.0.1:3000. Those requests are allowed only when the page's origin is
 * that same *.ts.net address, never any other *.ts.net site.
 */
const TS_SUFFIX = ".ts.net";

export function middleware(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return NextResponse.next();
  const origin = req.headers.get("origin");
  let originHost = "";
  try { originHost = origin ? new URL(origin).host : ""; } catch { /* malformed origin: blocked below */ }
  const host = req.headers.get("host") ?? "";
  const forwarded = (req.headers.get("x-forwarded-host") ?? "").split(",")[0].trim();
  const tailscaleHost = process.env.TAILSCALE_HOST ?? ""; // set by `npm run phone` from `tailscale status`

  const sameHost = !!originHost && originHost === host;
  const viaTailscale = originHost.endsWith(TS_SUFFIX) && origin?.startsWith("https://")
    && (originHost === forwarded || originHost === tailscaleHost);
  if (!sameHost && !viaTailscale) {
    return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
