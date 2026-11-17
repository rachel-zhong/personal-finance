"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { dollars } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface MonthPoint { key: string; label: string; income: number; net: number; returned: number; spent: number }

/**
 * Income (green) next to spending (orange, with returns in grey stacked on top) per month.
 * Click a month to load its analysis below.
 */
export default function IncomeSpendChart({ months, selected, query = "" }: { months: MonthPoint[]; selected: string; query?: string }) {
  const router = useRouter();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200;
  const max = Math.max(...months.map((m) => Math.max(m.income, Math.max(m.net, 0) + m.returned)), 1);
  const h = (v: number) => Math.max(0, Math.round((v / max) * H));

  return (
    <div className="relative">
      <div className="flex h-[236px] items-end gap-2 border-b border-border sm:gap-3" onMouseLeave={() => setHover(null)}>
        {months.map((m, i) => {
          const sel = m.key === selected;
          return (
            <button key={m.key} type="button" onClick={() => router.push(`/spending?month=${m.key}${query}`, { scroll: false })}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)}
              aria-pressed={sel} aria-label={`${m.label}: income ${dollars(m.income)}, spent ${dollars(m.net)}`}
              className={cn("flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end rounded-t-md px-0.5 pt-2 transition-opacity",
                sel ? "bg-accent/60" : "hover:bg-hairline", !sel && selected && "opacity-60 hover:opacity-100")}>
              <div className="flex w-full max-w-16 items-end justify-center gap-[2px]">
                <div className="flex w-1/2 max-w-6 flex-col justify-end">
                  {m.income > 0 && <div style={{ height: h(m.income) }} className="rounded-t bg-income" />}
                </div>
                <div className="flex w-1/2 max-w-6 flex-col justify-end">
                  {m.returned > 0 && <div style={{ height: h(m.returned) }} className={cn("bg-returned", m.net > 0 ? "rounded-t" : "rounded")} />}
                  {m.net > 0 && <div style={{ height: h(m.net), marginTop: m.returned > 0 ? 2 : 0 }} className={cn("bg-spend", m.returned === 0 && "rounded-t")} />}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2 sm:gap-3">
        {months.map((m) => (
          <span key={m.key} className={cn("min-w-0 flex-1 text-center text-[11px] text-muted-foreground", m.key === selected && "font-semibold text-foreground")}>
            {m.label}
          </span>
        ))}
      </div>
      {hover != null && (
        <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${Math.min(92, Math.max(8, ((hover + 0.5) / months.length) * 100))}%` }}>
          <div className="font-semibold">{months[hover].label}</div>
          <div><span className="mr-1.5 inline-block size-2 rounded-[2px] bg-income" />Income {dollars(months[hover].income)}</div>
          <div><span className="mr-1.5 inline-block size-2 rounded-[2px] bg-spend" />Spent {dollars(months[hover].net)}
            {months[hover].returned > 0 && <span className="text-muted-foreground"> · {dollars(months[hover].returned)} returned</span>}</div>
          <div className="text-muted-foreground">Saved {dollars(months[hover].income - months[hover].net)} · click to see the month</div>
        </div>
      )}
    </div>
  );
}
