import { cn } from "@/lib/utils";
import { money } from "@/lib/format";

/** Live totals for everything matching the current filters, with a one-line note on the view. */
export default function SubtotalBar({ type, totals, truncated, viewNote }: {
  type: "" | "in" | "out" | "refunds" | "unmatched" | "review";
  totals: { count: number; moneyIn: number; moneyOut: number; net: number };
  truncated: boolean;
  viewNote: string;
}) {
  const stat = (label: string, value: string, tone?: "in") => (
    <div className="flex flex-col items-end">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-[15px] font-semibold", tone === "in" && "text-income-ink")}>{value}</span>
    </div>
  );
  return (
    <section aria-label="Totals" className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-3">
      <span className="text-[13px] text-muted-foreground">
        {totals.count.toLocaleString()} transaction{totals.count === 1 ? "" : "s"}
        {truncated ? " · list shows newest 1,000, totals include all" : ""} · {viewNote}
      </span>
      <div className="flex flex-wrap items-center gap-6">
        {type !== "out" && stat("Money in", "+" + money(totals.moneyIn), "in")}
        {(type === "" || type === "out") && stat("Money out", money(-totals.moneyOut))}
        {!type && stat("Net", money(totals.net, { sign: true }))}
      </div>
    </section>
  );
}
