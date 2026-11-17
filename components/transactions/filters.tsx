"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type TypeKey = "" | "in" | "out" | "refunds" | "unmatched";

export interface FilterState {
  q: string; account: string; range: string; from: string; to: string; min: string; max: string; view: "net" | "raw"; type: TypeKey;
}

export const TYPE_BUTTONS: { key: TypeKey; label: string }[] = [
  { key: "", label: "All" }, { key: "in", label: "In" }, { key: "out", label: "Out" },
  { key: "refunds", label: "Refunds" }, { key: "unmatched", label: "Unmatched refunds" },
];

const input = "h-10 rounded-lg border border-input bg-card px-2.5 text-sm";

/**
 * Top to bottom: what kind of transaction (type buttons) with the Net / Raw switch set apart on the right,
 * then the narrowing filters on one row: search, account, dates, amount.
 */
export default function Filters({ initial, accounts, counts }: {
  initial: FilterState; accounts: { id: string; label: string }[];
  counts: Record<"all" | "in" | "out" | "refunds" | "unmatched", number>;
}) {
  const router = useRouter();
  const [f, setF] = useState(initial);

  function go(next: FilterState) {
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.account) p.set("account", next.account);
    if (next.range !== "60d") p.set("range", next.range);
    if (next.range === "custom") { if (next.from) p.set("from", next.from); if (next.to) p.set("to", next.to); }
    if (next.min) p.set("min", next.min);
    if (next.max) p.set("max", next.max);
    if (next.view === "raw") p.set("view", "raw");
    if (next.type) p.set("type", next.type);
    router.push(`/transactions${p.size ? `?${p}` : ""}`, { scroll: false });
  }
  const set = (patch: Partial<FilterState>, apply = false) => {
    const next = { ...f, ...patch };
    setF(next);
    if (apply) go(next);
  };
  const changed = (k: keyof FilterState) => f[k] !== initial[k];

  return (
    <section aria-label="Filters" className="flex flex-col rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div role="group" aria-label="Transaction type" className="flex flex-wrap gap-1.5">
          {TYPE_BUTTONS.map((t) => {
            const on = f.type === t.key;
            const n = counts[(t.key || "all") as keyof typeof counts];
            return (
              <button key={t.key} type="button" aria-pressed={on} onClick={() => set({ type: t.key }, true)}
                className={cn("min-h-9 rounded-lg border px-3 text-[13px] font-semibold",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-ink-2 hover:bg-hairline")}>
                {t.label}
                <span className={cn("ml-1.5 font-medium", on ? "text-primary-foreground/80" : "text-muted-foreground")}>{n.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
        <div role="group" aria-label="View" className="flex h-9 overflow-hidden rounded-lg border border-input">
          {(["net", "raw"] as const).map((v, i) => (
            <button key={v} type="button" aria-pressed={f.view === v} onClick={() => set({ view: v }, true)}
              title={v === "net" ? "Refunds netted against their purchase" : "Every transaction as the bank reported it"}
              className={cn("px-3.5 text-[13px] font-semibold", i > 0 && "border-l border-input",
                f.view === v ? "bg-primary text-primary-foreground" : "bg-card text-ink-2 hover:bg-hairline")}>
              {v === "net" ? "Net" : "Raw"}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); go(f); }} aria-label="Narrow down"
        className="flex flex-wrap gap-2.5 rounded-b-xl bg-field px-5 py-3.5">
        <div className="relative min-w-0 flex-[2_1_220px]">
          <label htmlFor="f-search" className="sr-only">Search</label>
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" />
          <input id="f-search" type="search" className={cn(input, "w-full pl-9 pr-3")} placeholder="Search merchant or description"
            value={f.q} onChange={(e) => set({ q: e.target.value })} onBlur={() => changed("q") && go(f)} />
        </div>
        <label className="flex min-w-0 flex-[1_1_150px]">
          <span className="sr-only">Account</span>
          <select value={f.account} onChange={(e) => set({ account: e.target.value }, true)} className={cn(input, "w-full")}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-[1_1_150px]">
          <span className="sr-only">Dates</span>
          <select value={f.range} onChange={(e) => set({ range: e.target.value }, e.target.value !== "custom")} className={cn(input, "w-full")}>
            <option value="60d">Last 60 days</option>
            <option value="month">This month</option>
            <option value="year">This year</option>
            <option value="all">All time</option>
            <option value="custom">Custom range…</option>
          </select>
        </label>
        {f.range === "custom" && (
          <div className="flex min-w-0 flex-[1_1_260px] items-center gap-1.5">
            <input aria-label="From date" type="date" className={cn(input, "min-w-0 flex-1")} value={f.from}
              onChange={(e) => set({ from: e.target.value })} onBlur={() => (changed("from") || changed("to")) && go(f)} />
            <span className="text-muted-foreground">–</span>
            <input aria-label="To date" type="date" className={cn(input, "min-w-0 flex-1")} value={f.to}
              onChange={(e) => set({ to: e.target.value })} onBlur={() => (changed("from") || changed("to")) && go(f)} />
          </div>
        )}
        <div className="flex min-w-0 flex-[1_1_200px] items-center gap-1.5">
          <label htmlFor="f-min" className="whitespace-nowrap text-[13px] text-muted-foreground">Amount</label>
          <input id="f-min" inputMode="decimal" placeholder="Min $" className={cn(input, "min-w-0 flex-1")} value={f.min}
            onChange={(e) => set({ min: e.target.value })} onBlur={() => (changed("min") || changed("max")) && go(f)} />
          <span className="text-muted-foreground">–</span>
          <input aria-label="Maximum amount" inputMode="decimal" placeholder="Max $" className={cn(input, "min-w-0 flex-1")} value={f.max}
            onChange={(e) => set({ max: e.target.value })} onBlur={() => (changed("min") || changed("max")) && go(f)} />
        </div>
        <button type="submit" className="sr-only">Apply filters</button>
      </form>
    </section>
  );
}
