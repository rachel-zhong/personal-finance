import "./globals.css";
import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";
import AppSidebar from "@/components/app-sidebar";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-grotesk" });

export const metadata: Metadata = { title: "My Money", description: "Local personal finance dashboard" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", inter.variable, grotesk.variable)}>
      <body>
        <div className="flex min-h-screen flex-wrap bg-background text-foreground">
          <AppSidebar />
          <main className="flex min-w-0 max-w-[1240px] flex-[999_1_560px] flex-col gap-5 px-5 py-8 sm:px-10 sm:pb-12">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
