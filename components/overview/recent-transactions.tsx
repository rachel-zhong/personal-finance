import Link from "next/link";
import { cn } from "@/lib/utils";
import { dayShort, displayAmount } from "@/lib/format";
import type { RecentTxn } from "@/lib/queries";

const KIND = {
  In: { chip: "bg-[#DCFCE7] text-[#15803D]", amount: "text-income-ink", dot: "bg-income" },
  Out: { chip: "bg-[#FFEDD5] text-[#9A3412]", amount: "text-foreground", dot: "bg-spend" },
  Transfer: { chip: "bg-hairline text-ink-2", amount: "text-muted-foreground", dot: "bg-[#A1A1AA]" },
} as const;

/** The latest transactions across all accounts, each labeled In / Out / Transfer. Scrolls inside its own box. */
export default function RecentTransactions({ rows, className }: { rows: RecentTxn[]; className?: string }) {
  return (
    <section aria-label="Recent transactions" className={cn("flex min-w-0 flex-col rounded-xl border border-border bg-card px-6 py-5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Recent transactions</h2>
        <Link href="/transactions" className="tight text-[13px] font-semibold no-underline hover:underline">See all</Link>
      </div>
      <div className="flex flex-wrap gap-3 pb-2.5 pt-2 text-xs text-muted-foreground">
        {(["In", "Out", "Transfer"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", KIND[k].dot)} />{k === "Transfer" ? "Transfer between my accounts" : k}
          </span>
        ))}
      </div>
      <div className="relative min-h-[420px] flex-1">
        <div className="absolute inset-0 overflow-y-auto">
          {!rows.length && <p className="py-3 text-sm text-muted-foreground">No transactions yet.</p>}
          {rows.map((r) => {
            const k = KIND[r.kind];
            return (
              <div key={r.id} className="flex items-center gap-3 border-t border-hairline py-2.5">
                <span className={cn("w-[72px] flex-none rounded-full py-[3px] text-center text-[11px] font-bold", k.chip)}>{r.kind}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-sm font-medium">{r.desc}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {dayShort(r.date)} · {r.account}{r.pending ? " · pending" : ""}
                  </span>
                </div>
                <span className={cn("whitespace-nowrap text-sm font-semibold", k.amount)}>
                  {displayAmount(r.amount, r.kind === "Transfer" ? "transfer" : r.amount > 0 ? "income" : "spend").text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
