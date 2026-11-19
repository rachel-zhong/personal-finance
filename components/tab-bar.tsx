"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgeDollarSign, LayoutDashboard, PieChart, ReceiptText, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Net worth", Icon: LayoutDashboard },
  { href: "/spending", label: "Spending", Icon: PieChart },
  { href: "/transactions", label: "Transactions", Icon: ReceiptText },
  { href: "/investments", label: "Investments", Icon: TrendingUp },
  { href: "/compensation", label: "Pay", Icon: BadgeDollarSign },
];

/** Phone navigation: fixed to the bottom, clear of the iPhone home indicator. Hidden from 768px up (the sidebar takes over). */
export default function TabBar({ showPay = true }: { showPay?: boolean }) {
  const path = usePathname();
  const tabs = showPay ? TABS : TABS.filter((t) => t.href !== "/compensation");
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/accounts") : path.startsWith(href));
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className={cn("mx-auto grid max-w-lg", tabs.length === 5 ? "grid-cols-5" : "grid-cols-4")}>
        {tabs.map(({ href, label, Icon }) => {
          const on = active(href);
          return (
            <Link key={href} href={href} aria-current={on ? "page" : undefined}
              className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold no-underline",
                on ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-muted-foreground")}>
              <Icon className="size-[22px]" strokeWidth={on ? 2.25 : 1.75} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
