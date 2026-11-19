"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgeDollarSign, Landmark, LayoutDashboard, PieChart, ReceiptText, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem { href: string; label: string; Icon: LucideIcon }

/** Same order as the phone tab bar. Net worth is the home page. */
export const MAIN: NavItem[] = [
  { href: "/", label: "Net worth", Icon: LayoutDashboard },
  { href: "/spending", label: "Spending", Icon: PieChart },
  { href: "/transactions", label: "Transactions", Icon: ReceiptText },
  { href: "/investments", label: "Investments", Icon: TrendingUp },
  { href: "/compensation", label: "Compensation", Icon: BadgeDollarSign },
];
const MORE: NavItem[] = [
  { href: "/connect", label: "Connections & files", Icon: Landmark },
];

export const isActive = (path: string, href: string) =>
  href === "/" ? path === "/" || path.startsWith("/accounts") : path.startsWith(href);

export default function NavLinks({ showPay = true }: { showPay?: boolean }) {
  const path = usePathname();
  const main = showPay ? MAIN : MAIN.filter((l) => l.href !== "/compensation");
  const item = ({ href, label, Icon }: NavItem) => {
    const on = isActive(path, href);
    return (
      <Link key={href} href={href} aria-current={on ? "page" : undefined}
        className={cn(
          "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm no-underline transition-colors",
          on ? "bg-accent font-semibold text-accent-foreground hover:bg-accent hover:text-accent-foreground"
            : "font-medium text-ink-2 hover:bg-hairline hover:text-foreground",
        )}>
        {on && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary" />}
        <Icon className={cn("size-[18px] flex-none", on ? "text-primary" : "text-muted-foreground")} strokeWidth={on ? 2.25 : 1.75} aria-hidden="true" />
        {label}
      </Link>
    );
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">{main.map(item)}</div>
      <div className="flex flex-col gap-1 border-t border-border pt-4">
        <span className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Data</span>
        {MORE.map(item)}
      </div>
    </div>
  );
}
