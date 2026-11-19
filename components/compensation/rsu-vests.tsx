"use client";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { dayShort, dollars, money, shortDate } from "@/lib/format";

export interface VestDate {
  date: string; value: number; taxes: number; kept: number; payout: { date: string; amount: number } | null;
  grants: { value: number; taxes: number; kept: number; shares: number | null; fx: number | null }[];
}

const GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 md:grid-cols-[minmax(0,1.3fr)_1fr_1.2fr_1fr_1.2fr] md:items-center";
const rate = (t: number, v: number) => (v ? `${((t / v) * 100).toFixed(1)}%` : "");

/** CP-11: one row per vest date (open it for each grant), with the year's total. */
export default function RsuVests({ year, vests }: { year: string; vests: VestDate[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const sum = (f: (v: VestDate) => number) => vests.reduce((t, v) => t + f(v), 0);
  const total = { value: sum((v) => v.value), taxes: sum((v) => v.taxes), kept: sum((v) => v.kept), payout: sum((v) => v.payout?.amount ?? 0) };

  return (
    <section aria-label="RSU vests" className="flex min-w-0 flex-col rounded-xl border border-border bg-card">
      <div className="px-5 pb-3 pt-4">
        <h2 className="text-base font-semibold">RSU vests</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Value at vest = your cost basis when you sell.
        </p>
      </div>
      <div className={cn(GRID, "hidden border-y border-border bg-field px-5 py-2 text-xs font-semibold text-muted-foreground md:grid")}>
        <span>Vest date</span><span className="text-right">Value at vest</span><span className="text-right">Taxes withheld</span>
        <span className="text-right">Kept as shares</span><span className="text-right">Sale payout</span>
      </div>
      {!vests.length && <p className="px-5 pb-5 text-sm text-muted-foreground">No vests in {year}.</p>}
      {vests.map((v) => {
        const isOpen = open.has(v.date);
        return (
          <Fragment key={v.date}>
            <button type="button" aria-expanded={isOpen} onClick={() => toggle(v.date)}
              className={cn(GRID, "w-full gap-y-0.5 border-t border-hairline px-5 py-3 text-left text-sm hover:bg-hairline")}>
              <span className="flex items-center gap-1.5 font-medium">
                {isOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                <span className="whitespace-nowrap">{dayShort(v.date)}</span> <span className="whitespace-nowrap text-xs font-normal text-muted-foreground">· {v.grants.length} grant{v.grants.length === 1 ? "" : "s"}</span>
              </span>
              <span className="text-right font-semibold tabular-nums">{dollars(v.value)}</span>
              <span className="hidden text-right tabular-nums md:block">{dollars(v.taxes)} <span className="text-xs text-muted-foreground">{rate(v.taxes, v.value)}</span></span>
              <span className="hidden text-right tabular-nums md:block">{dollars(v.kept)}</span>
              <span className="hidden text-right tabular-nums md:block">
                {v.payout ? <>{money(v.payout.amount)} <span className="text-xs text-muted-foreground">{shortDate(v.payout.date).replace(/, \d{4}$/, "")}</span></> : <span className="text-muted-foreground">—</span>}
              </span>
              <span className="pl-[22px] text-xs text-muted-foreground md:hidden">
                Taxes {dollars(v.taxes)} ({rate(v.taxes, v.value)}) · kept {dollars(v.kept)}{v.payout ? ` · payout ${money(v.payout.amount)}` : ""}
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-hairline bg-field px-5 py-2 text-[13px]">
                {v.grants.map((g, i) => (
                  <div key={i} className={cn(GRID, "py-1 text-ink-2")}>
                    <span className="pl-[22px]">Grant {i + 1}{g.shares != null ? ` · ${g.shares} sh` : ""}{g.fx != null ? ` · FX ${g.fx}` : ""}</span>
                    <span className="text-right tabular-nums">{money(g.value)}</span>
                    <span className="hidden text-right tabular-nums md:block">{money(g.taxes)}</span>
                    <span className="hidden text-right tabular-nums md:block">{money(g.kept)}</span>
                    <span className="hidden md:block" />
                  </div>
                ))}
                {v.payout && (
                  <p className="pl-[22px] pt-1 text-xs text-muted-foreground">
                    {money(v.payout.amount)} from selling shares was paid with your paycheck on {shortDate(v.payout.date)}. Fees or exchange costs, if any, aren&apos;t shown on pay statements.
                  </p>
                )}
              </div>
            )}
          </Fragment>
        );
      })}
      {vests.length > 0 && (
        <div className={cn(GRID, "border-t-2 border-border px-5 py-3 text-sm font-semibold")}>
          <span className="pl-[22px]">{year} total</span>
          <span className="text-right tabular-nums">{dollars(total.value)}</span>
          <span className="hidden text-right tabular-nums md:block">{dollars(total.taxes)} <span className="text-xs font-normal text-muted-foreground">{rate(total.taxes, total.value)}</span></span>
          <span className="hidden text-right tabular-nums md:block">{dollars(total.kept)}</span>
          <span className="hidden text-right tabular-nums md:block">{total.payout ? money(total.payout) : "—"}</span>
          <span className="pl-[22px] text-xs font-normal text-muted-foreground md:hidden">Taxes {dollars(total.taxes)} · kept {dollars(total.kept)}</span>
        </div>
      )}
    </section>
  );
}
