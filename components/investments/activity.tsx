"use client";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { dayShort, money, shortDate } from "@/lib/format";
import type { ActivityKind, ActivityRow } from "@/lib/investments";

const KINDS: { key: ActivityKind; label: string }[] = [
  { key: "buy", label: "Buys" },
  { key: "sell", label: "Sells" },
  { key: "dividend", label: "Dividends" },
  { key: "contribution", label: "Contributions" },
  { key: "fee", label: "Fees" },
  { key: "other", label: "Other" },
];
const KIND_LABEL: Record<ActivityKind, string> = { buy: "Buy", sell: "Sell", dividend: "Dividend", contribution: "Contribution", fee: "Fee", other: "Other" };
const pill = (on: boolean) => cn("min-h-9 rounded-lg border px-3 text-[13px] font-semibold",
  on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-ink-2 hover:bg-hairline");
const monthName = (k: string) => new Date(k + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
const GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 md:grid-cols-[90px_minmax(0,1.6fr)_minmax(0,1.2fr)_110px_90px_120px] md:items-center";

/** IN-15: buys, sells, dividends and contributions, filtered by month and type. Cash into the account shows green. */
export interface DividendInfo { year: number; total: number | null; count: number; complete: boolean }

export default function Activity({ rows, dividends }: { rows: ActivityRow[]; dividends: DividendInfo }) {
  const months = useMemo(() => [...new Set(rows.map((r) => r.date.slice(0, 7)))], [rows]);
  const [month, setMonth] = useState<string>("all");
  const [kind, setKind] = useState<ActivityKind | null>(null);
  const inMonth = rows.filter((r) => month === "all" || r.date.startsWith(month));
  const shown = inMonth.filter((r) => !kind || r.kind === kind);
  const counts = Object.fromEntries(KINDS.map((k) => [k.key, inMonth.filter((r) => r.kind === k.key).length]));

  return (
    <section aria-label="Activity" className="flex min-w-0 flex-col rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Activity</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rows.length ? `${shown.length} · from your brokers since ${shortDate(rows[rows.length - 1].date)}` : "Buys, sells, dividends and contributions from your brokers"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
        <span className="text-[13px] text-ink-2" title={dividends.complete ? undefined : "Your broker only shares recent activity, so earlier dividends this year are missing."}>
          Dividends {dividends.year}:{" "}
          <span className="font-semibold">{dividends.complete && dividends.total != null ? money(dividends.total) : "—"}</span>
          {!dividends.complete && rows.length > 0 && (
            <span className="text-xs text-muted-foreground"> · {dividends.total ? `${money(dividends.total)} since ${shortDate(rows[rows.length - 1].date)}, ` : ""}history incomplete</span>
          )}
        </span>
        {months.length > 0 && (
          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
            Month
            <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] font-normal text-foreground">
              <option value="all">All months</option>
              {months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
          </label>
        )}
        </div>
      </div>
      {rows.length > 0 && (
        <div role="group" aria-label="Activity type" className="flex flex-wrap gap-1.5 border-b border-border px-5 pb-3.5">
          <button type="button" aria-pressed={!kind} onClick={() => setKind(null)} className={pill(!kind)}>All <span className="font-normal opacity-80">{inMonth.length}</span></button>
          {KINDS.filter((k) => counts[k.key]).map((k) => (
            <button key={k.key} type="button" aria-pressed={kind === k.key} onClick={() => setKind(kind === k.key ? null : k.key)} className={pill(kind === k.key)}>
              {k.label} <span className="font-normal opacity-80">{counts[k.key]}</span>
            </button>
          ))}
        </div>
      )}
      {!rows.length && <p className="px-5 pb-5 text-sm text-muted-foreground">No activity yet. It appears after you add investment details on the Connections page.</p>}
      {rows.length > 0 && !shown.length && <p className="px-5 py-6 text-sm text-muted-foreground">Nothing matches these filters.</p>}
      {shown.length > 0 && (
        <div role="row" className={cn(GRID, "hidden bg-field px-5 py-2 text-xs font-semibold text-muted-foreground md:grid")}>
          <span>Date</span><span>Description</span><span>Account</span><span>Type</span><span className="text-right">Shares</span><span className="text-right">Amount</span>
        </div>
      )}
      {shown.map((r) => (
        <div key={r.id} className={cn(GRID, "border-t border-hairline px-5 py-2.5 text-sm")}>
          <span className="hidden text-ink-2 md:block">{dayShort(r.date)}</span>
          <span className="min-w-0 truncate font-medium">{r.ticker ? `${r.ticker} · ` : ""}{r.name}</span>
          <span className="hidden min-w-0 truncate text-ink-2 md:block">{r.account}</span>
          <span className="hidden text-ink-2 md:block">{KIND_LABEL[r.kind]}</span>
          <span className="hidden text-right tabular-nums text-ink-2 md:block">{r.quantity ? r.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}</span>
          <span className={cn("text-right font-semibold tabular-nums", r.amount > 0 && "text-income-ink")}>
            {r.amount > 0 ? "+" : ""}{money(Math.abs(r.amount))}
          </span>
          {/* Phone second line */}
          <span className="col-span-2 text-xs text-muted-foreground md:hidden">
            {dayShort(r.date)} · {KIND_LABEL[r.kind]}{r.quantity ? ` · ${r.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} sh` : ""} · {r.account}
          </span>
        </div>
      ))}
    </section>
  );
}
