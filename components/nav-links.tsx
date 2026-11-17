"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const MAIN = [
  { href: "/", label: "Overview" },
  { href: "/spending", label: "Spending" },
  { href: "/transactions", label: "Transactions" },
];
const MORE = [
  { href: "/connect", label: "Connections" },
];

export default function NavLinks() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/accounts") : path.startsWith(href));
  const item = (l: { href: string; label: string }, small = false) => (
    <Link key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}
      className={cn(
        "rounded-lg px-3 no-underline transition-colors hover:bg-hairline",
        small ? "py-2 text-[13px]" : "py-2.5 text-sm",
        active(l.href) ? "bg-accent font-semibold text-accent-foreground hover:bg-accent" : "font-medium text-ink-2 hover:text-ink-2",
      )}>
      {l.label}
    </Link>
  );
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">{MAIN.map((l) => item(l))}</div>
      <div className="flex flex-col gap-1">
        <span className="px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Data</span>
        {MORE.map((l) => item(l, true))}
      </div>
    </div>
  );
}
