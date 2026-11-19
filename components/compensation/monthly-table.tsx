"use client";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { dollars } from "@/lib/format";

export interface TableRow { label: string; values: number[]; total: number; nonCash?: boolean }
export interface TableGroupData { key: string; label: string; sign: "+" | "−"; values: number[]; total: number; rows: TableRow[]; nonCash?: boolean }

const cell = (v: number) => (v === 0 ? <span className="text-muted-foreground">—</span> : dollars(v));
const STRIPES = "bg-[repeating-linear-gradient(135deg,transparent_0_6px,var(--hairline)_6px_8px)] text-muted-foreground";

/**
 * CP-9: months across, then the monthly average (completed months only) and YTD. Groups start collapsed and open
 * to their line items. RSU rows are striped and marked non-cash. Scrolls sideways inside the card on narrow screens.
 */
export default function MonthlyTable({ months, complete, groups, net }: {
  months: string[]; complete: boolean[]; groups: TableGroupData[]; net: { values: number[]; total: number };
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const expandable = groups.filter((g) => g.rows.length);
  const all = open.size === expandable.length;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const head = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" });
  const nDone = complete.filter(Boolean).length;
  const avg = (vals: number[]) => (nDone ? Math.round(vals.reduce((t, v, i) => t + (complete[i] ? v : 0), 0) / nDone) : 0);
  const sticky = "sticky left-0 z-10 bg-card";
  const partial = (i: number) => !complete[i] && "text-muted-foreground";
  const sums = "border-l border-border";

  return (
    <section aria-label="Monthly breakdown" className="flex min-w-0 flex-col rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Month by month</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">By pay date. Striped rows are RSU stock, not cash.</p>
        </div>
        <button type="button" onClick={() => setOpen(all ? new Set() : new Set(expandable.map((g) => g.key)))}
          className="h-9 rounded-lg border border-input bg-card px-3 text-[13px] font-semibold text-ink-2 hover:bg-hairline">
          {all ? "Collapse all" : "Expand all"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="border-y border-border bg-field text-xs font-semibold text-muted-foreground">
              <th className={cn(sticky, "bg-field px-5 py-2 text-left font-semibold")}>&nbsp;</th>
              {months.map((m, i) => (
                <th key={m} className="px-2 py-2 text-right font-semibold">
                  {head(m)}{!complete[i] && <span className="block text-[10px] font-normal">so far</span>}
                </th>
              ))}
              <th className={cn(sums, "px-3 py-2 text-right font-semibold text-foreground")}>Monthly avg</th>
              <th className={cn(sums, "px-4 py-2 text-right font-semibold text-foreground")}>YTD</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = open.has(g.key);
              return (
                <Fragment key={g.key}>
                  <tr className={cn("border-t border-hairline", g.nonCash && STRIPES)}>
                    <th scope="row" className={cn(sticky, "px-5 py-2 text-left font-semibold", g.nonCash && "bg-field")}>
                      {g.rows.length ? (
                        <button type="button" aria-expanded={isOpen} onClick={() => toggle(g.key)} className="tight flex items-center gap-1 whitespace-nowrap">
                          {isOpen ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
                          <span className="w-3 text-muted-foreground">{g.sign}</span>{g.label}
                        </button>
                      ) : (
                        <span className="flex items-center gap-1 whitespace-nowrap pl-5">
                          <span className="w-3">{g.sign}</span>{g.label}
                          {g.nonCash && <span className="ml-1 rounded-full border border-input px-1.5 py-px text-[10px] font-semibold">non-cash</span>}
                        </span>
                      )}
                    </th>
                    {g.values.map((v, i) => <td key={i} className={cn("px-2 py-2 text-right", !g.nonCash && "font-semibold", partial(i))}>{cell(v)}</td>)}
                    <td className={cn(sums, "px-3 py-2 text-right", !g.nonCash && "font-semibold")}>{cell(avg(g.values))}</td>
                    <td className={cn(sums, "px-4 py-2 text-right", !g.nonCash && "font-semibold")}>{cell(g.total)}</td>
                  </tr>
                  {isOpen && g.rows.map((r) => (
                    <tr key={r.label} className={cn("text-ink-2", r.nonCash && STRIPES)}>
                      <th scope="row" className={cn(sticky, "py-1.5 pl-[52px] pr-5 text-left font-normal", r.nonCash && "bg-field")}>
                        <span className="whitespace-nowrap">{r.label}</span>
                      </th>
                      {r.values.map((v, i) => <td key={i} className={cn("px-2 py-1.5 text-right", partial(i))}>{cell(v)}</td>)}
                      <td className={cn(sums, "px-3 py-1.5 text-right")}>{cell(avg(r.values))}</td>
                      <td className={cn(sums, "px-4 py-1.5 text-right")}>{cell(r.total)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            <tr className="border-t-2 border-border">
              <th scope="row" className={cn(sticky, "px-5 py-2.5 text-left font-semibold")}><span className="ml-5">= Take-home</span></th>
              {net.values.map((v, i) => <td key={i} className={cn("px-2 py-2.5 text-right font-semibold", complete[i] ? "text-income-ink" : "text-muted-foreground")}>{cell(v)}</td>)}
              <td className={cn(sums, "px-3 py-2.5 text-right font-semibold text-income-ink")}>{cell(avg(net.values))}</td>
              <td className={cn(sums, "px-4 py-2.5 text-right font-semibold text-income-ink")}>{cell(net.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
