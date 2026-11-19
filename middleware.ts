import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sessionValid } from "@/lib/auth";

/**
 * Runs before every page and API route.
 *
 * 1. Login (hosted): when APP_PASSWORD is set, everything needs a valid session cookie except the login page,
 *    the login API, the health check and the home-screen icons. Pages redirect to /login; APIs answer 401.
 *    On your Mac without APP_PASSWORD there is no login.
 *
 * 2. Same-site check (CSRF): API calls that change data must come from this app's own pages, so another website
 *    open in your browser can't POST to it. Allowed origins:
 *    - the address the request came in on (localhost, or the Railway domain)
 *    - RAILWAY_PUBLIC_DOMAIN / APP_DOMAIN, in case a proxy rewrites the Host header
 *    - over Tailscale, only this Mac's own *.ts.net address (set by `npm run phone`)
 */
const TS_SUFFIX = ".ts.net";
const PUBLIC = [/^\/login$/, /^\/api\/auth\/login$/, /^\/api\/health$/, /^\/manifest\.webmanifest$/, /^\/icons\//, /^\/favicon\.ico$/];

function sameSite(req: NextRequest) {
  const origin = req.headers.get("origin");
  let originHost = "";
  try { originHost = origin ? new URL(origin).host : ""; } catch { /* malformed origin: blocked */ }
  if (!originHost) return false;
  const host = req.headers.get("host") ?? "";
  const forwarded = (req.headers.get("x-forwarded-host") ?? "").split(",")[0].trim();
  const appDomains = [process.env.RAILWAY_PUBLIC_DOMAIN, process.env.APP_DOMAIN].filter(Boolean);
  if (originHost === host || appDomains.includes(originHost)) return true;
  if (origin?.startsWith("https://") && appDomains.length && originHost === forwarded && appDomains.includes(forwarded)) return true;
  const tailscaleHost = process.env.TAILSCALE_HOST ?? "";
  return originHost.endsWith(TS_SUFFIX) && !!origin?.startsWith("https://") && (originHost === forwarded || originHost === tailscaleHost);
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  if (process.env.APP_PASSWORD && !PUBLIC.some((re) => re.test(path))) {
    if (!sessionValid(req.cookies.get(SESSION_COOKIE)?.value)) {
      if (isApi) return NextResponse.json({ error: "Please log in" }, { status: 401 });
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + req.nextUrl.search)}`;
      return NextResponse.redirect(url);
    }
  }

  if (isApi && req.method !== "GET" && req.method !== "HEAD" && !sameSite(req)) {
    return NextResponse.json({ error: "Cross-origin request blocked" }, { status: 403 });
  }
  // Tell the layout which page this is, so the login page renders without the app's navigation.
  const headers = new Headers(req.headers);
  headers.set("x-mm-path", path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Node.js runtime so the session check can use node:crypto (stable since Next.js 15.5)
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image).*)"],
};
