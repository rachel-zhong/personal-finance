import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";
import AppSidebar from "@/components/app-sidebar";
import TabBar from "@/components/tab-bar";
import SyncButton from "@/components/SyncButton";
import { HIDE_AMOUNTS_SCRIPT } from "@/components/privacy-toggle";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { headers } from "next/headers";
import { compensationEnabled } from "@/lib/hosted";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-grotesk" });

export const metadata: Metadata = {
  title: "My Money",
  description: "Local personal finance dashboard",
  applicationName: "My Money",
  authors: [{ name: "rachel-zhong", url: "https://github.com/rachel-zhong" }],
  creator: "rachel-zhong",
  // Home-screen app on iPhone: opens full-screen, with its own icon and name
  appleWebApp: { capable: true, title: "Money", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
  // Older iOS versions only open full-screen with the original Apple tag
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // lets the tab bar sit in the safe area above the home indicator
  themeColor: "#0F6B5C",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-mm-path") ?? "";
  const showPay = compensationEnabled();
  // The login page shows nothing of the app (no navigation, no sync time) until you're signed in.
  if (path === "/login") {
    return (
      <html lang="en" className={cn("font-sans", inter.variable, grotesk.variable)} suppressHydrationWarning>
        <body className="bg-background px-4 text-foreground">{children}</body>
      </html>
    );
  }
  return (
    <html lang="en" className={cn("font-sans", inter.variable, grotesk.variable)} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HIDE_AMOUNTS_SCRIPT }} />
      </head>
      <body>
        <div className="flex min-h-screen bg-background text-foreground">
          <AppSidebar showPay={showPay} />
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Phone header: logo and Sync now (the sidebar is hidden under 768px) */}
            <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+8px)] backdrop-blur md:hidden">
              <div className="flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-primary">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></svg>
                </div>
                <span className="font-heading text-base font-bold">My Money</span>
              </div>
              <div className="flex items-center gap-1">
                {/* Connections lives here on phones; the tab bar has room for five tabs */}
                <Link href="/connect" aria-label="Connections &amp; files" className="flex size-11 items-center justify-center rounded-lg text-ink-2 hover:bg-hairline">
                  <Landmark className="size-5" aria-hidden="true" />
                </Link>
                <SyncButton compact />
              </div>
            </header>
            <main className="flex w-full min-w-0 max-w-[1240px] flex-col gap-5 px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-5 md:px-10 md:py-8 md:pb-12">
              {children}
            </main>
          </div>
        </div>
        <TabBar showPay={showPay} />
      </body>
    </html>
  );
}
