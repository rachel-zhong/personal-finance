"use client";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { categoryLabel, isPayback, isReviewable } from "@/lib/categories";
import { dollars, money } from "@/lib/format";
import type { MatchRow, TxnRow } from "@/lib/queries";
import TxnTable, { TxnSort } from "../TxnTable";

export interface CategoryBar { category: string; net: number; purchases: number; returned: number }

type TypeFilter = "all" | "in" | "out" | "returns" | "unmatched" | "review";

// Card payments only move money between your own accounts, so they're left out of In and Out.
const isCardPayment = (t: TxnRow) => t.category === "card_payment";

const TYPES: { key: TypeFilter; label: string; test: (t: TxnRow) => boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "in", label: "In", test: (t) => t.amount > 0 && !isCardPayment(t) },
  { key: "out", label: "Out", test: (t) => t.amount < 0 && !isCardPayment(t) },
  { key: "returns", label: "Refunds", test: (t) => t.flow === "refund" && !isPayback(t) },
  { key: "unmatched", label: "Unmatched refunds", test: (t) => t.flow === "refund" && t.amount - t.applied > 0 && !isPayback(t) },
  { key: "review", label: "Paybacks to review", test: (t) => !t.excluded && !t.pending && isReviewable(t) },
];

const SORTS: { key: string; label: string; sort: TxnSort }[] = [
  { key: "date-desc", label: "Newest first", sort: { key: "date", dir: -1 } },
  { key: "date-asc", label: "Oldest first", sort: { key: "date", dir: 1 } },
  { key: "amount-desc", label: "Amount: high to low", sort: { key: "amount", dir: -1 } },
  { key: "amount-asc", label: "Amount: low to high", sort: { key: "amount", dir: 1 } },
  { key: "merchant-asc", label: "Merchant: A to Z", sort: { key: "merchant", dir: 1 } },
  { key: "category-asc", label: "Category: A to Z", sort: { key: "category", dir: 1 } },
];

/** Net spending a row contributes, as shown in the net view. */
const rowNet = (t: TxnRow) =>
  t.flow === "spend" ? -(t.amount + t.refunded) : t.flow === "refund" ? -(t.amount - t.applied) : 0;

/**
 * The selected month's categories and transactions. Everything here filters instantly:
 * click categories (several at once), pick a type (e.g. only returns), and sort.
 */
export default function MonthExplorer({ monthLabel, categories, rows, matches, truncated, extraRefunds, returnCounts, notMineAccounts, averages }: {
  monthLabel: string; categories: CategoryBar[]; rows: TxnRow[]; matches: Record<string, MatchRow[]>; truncated: boolean;
  /** Refunds received in other months that are matched to this month's purchases. */
  extraRefunds: TxnRow[];
  /** Per refund: how much counts as "returned" in this month (same basis as the month's totals). */
  returnCounts: Record<string, number>;
  month: string;
  /** Accounts held for others / excluded from spending: their income isn't counted as yours. */
  notMineAccounts: string[];
  /** Rendered beside the category breakdown (optional). */
  averages?: ReactNode;
}) {
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [type, setType] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<TxnSort>({ key: "date", dir: -1 });
  const top = Math.max(...categories.map((c) => c.net), 1);

  const toggleCat = (c: string) => setCats((s) => {
    const n = new Set(s);
    if (n.has(c)) n.delete(c); else n.add(c);
    return n;
  });

  const isReturnsView = type === "returns" || type === "unmatched";
  const extraIds = useMemo(() => new Set(extraRefunds.map((r) => r.id)), [extraRefunds]);

  // Everything the category filter lets through, before the type buttons narrow it (the buttons show counts of these).
  const inCats = useMemo(() => {
    const pool = [...rows, ...extraRefunds];
    return pool.filter((r) => !cats.size || cats.has(r.category ?? ""));
  }, [rows, extraRefunds, cats]);
  const counts = useMemo(() => Object.fromEntries(TYPES.map((t) => [t.key,
    inCats.filter((r) => (t.key === "returns" || !extraIds.has(r.id)) && t.test(r)).length])) as Record<TypeFilter, number>, [inCats, extraIds]);
  const visible = useMemo(() => {
    const t = TYPES.find((x) => x.key === type)!;
    // Refunds also include those that arrived in another month for this month's purchases.
    return inCats.filter((r) => (type === "returns" || !extraIds.has(r.id)) && t.test(r));
  }, [inCats, extraIds, type]);
  const totalNet = visible.reduce((s, r) => s + (extraIds.has(r.id) ? 0 : rowNet(r)), 0);
  const totalReturned = visible.reduce((s, r) => s + (returnCounts[r.id] ?? 0), 0);
  const notMine = useMemo(() => new Set(notMineAccounts), [notMineAccounts]);
  const moneyIn = visible.reduce((s, r) => s + (r.amount > 0 ? r.amount : 0), 0);
  const moneyOut = visible.reduce((s, r) => s + (r.amount < 0 ? -r.amount : 0), 0);

  // Explain refunds whose amount counts in a different month than they arrived.
  const notes = useMemo(() => {
    const n: Record<string, string> = {};
    if (type === "in") {
      for (const r of visible) if (notMine.has(r.account_id)) n[r.id] = "Account held for others · not counted as your income";
      return n;
    }
    if (!isReturnsView) return n;
    for (const r of visible) {
      if (r.flow !== "refund") continue;
      const counts = returnCounts[r.id] ?? 0;
      if (extraIds.has(r.id)) {
        n[r.id] = `Received ${new Date(r.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${money(counts)} counts in ${monthLabel} (for a ${monthLabel} purchase)`;
      } else if (counts < r.amount) {
        n[r.id] = counts > 0
          ? `${money(counts)} counts in ${monthLabel}; the rest goes with an earlier purchase's month`
          : `Counts in an earlier month, with the purchase it returns`;
      }
    }
    return n;
  }, [visible, isReturnsView, returnCounts, extraIds, monthLabel, type, notMine]);
  const sortKey = SORTS.find((x) => x.sort.key === sort.key && x.sort.dir === sort.dir)?.key ?? "custom";

  return (
    <>
      <div className="flex flex-wrap items-stretch gap-4">
      {averages ? <div className="flex min-w-0 flex-[2_1_340px]">{averages}</div> : null}
      <section aria-label={`${monthLabel} by category`} className="flex min-w-0 flex-[3_1_440px] flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">By category</h2>
          <span className="text-xs text-muted-foreground">
            {cats.size
              ? <button type="button" className="text-primary hover:underline" onClick={() => setCats(new Set())}>Show all categories</button>
              : "Click to filter transactions"}
          </span>
        </div>
        {!categories.length && <p className="text-sm text-muted-foreground">No spending this month.</p>}
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          {categories.map((c) => {
            const on = cats.has(c.category);
            return (
              <button key={c.category} type="button" aria-pressed={on} onClick={() => toggleCat(c.category)}
                className={cn("flex flex-col gap-1.5 rounded-lg px-2 py-2 text-left hover:bg-hairline",
                  on && "bg-accent hover:bg-accent", cats.size > 0 && !on && "opacity-55")}>
                <div className="flex justify-between gap-2 text-sm">
                  <span>{categoryLabel(c.category)}</span>
                  <span className="font-semibold">{dollars(c.net)}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-hairline">
                  <div className="h-2 rounded-full bg-spend" style={{ width: `${Math.max(0, Math.round((c.net / top) * 100))}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {c.returned >= 50 ? `After ${dollars(c.returned)} in returns · ` : ""}{c.purchases} transaction{c.purchases === 1 ? "" : "s"}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      </div>

      {/* Title first, then the filters, then the rows: all in one card */}
      <section id="transactions" aria-label={`${monthLabel} transactions`} className="flex scroll-mt-4 flex-col rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              Transactions{cats.size ? <span className="font-normal text-muted-foreground"> · {[...cats].map(categoryLabel).join(", ")}</span> : null}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {visible.length} · {isReturnsView
                ? type === "unmatched" ? `${money(visible.reduce((t, r) => t + Math.max(0, r.amount - r.applied), 0))} still to match` : `${money(totalReturned)} returned in ${monthLabel}`
                : type === "in" ? `+${money(moneyIn)} in`
                : type === "out" ? `${money(moneyOut)} out`
                : `${money(totalNet)} spending`}{truncated ? " · newest 1,000 loaded" : ""}
            </p>
          </div>
          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
            Sort
            <select aria-label="Sort transactions" value={sortKey}
              onChange={(e) => { const s = SORTS.find((x) => x.key === e.target.value); if (s) setSort(s.sort); }}
              className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] font-normal text-foreground">
              {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              {sortKey === "custom" && <option value="custom">Custom (column header)</option>}
            </select>
          </label>
        </div>
        <div role="group" aria-label="Transaction type" className="flex flex-wrap gap-1.5 border-b border-border px-5 pb-3.5">
          {TYPES.map((t) => (
            <button key={t.key} type="button" aria-pressed={type === t.key} onClick={() => setType(t.key)}
              className={cn("min-h-9 rounded-lg border px-3 text-[13px] font-semibold",
                type === t.key ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-ink-2 hover:bg-hairline")}>
              {t.label}
              <span className={cn("ml-1.5 font-medium", type === t.key ? "text-primary-foreground/80" : "text-muted-foreground")}>{counts[t.key]}</span>
            </button>
          ))}
        </div>
        {visible.length === 0
          ? <p className="px-5 py-6 text-sm text-muted-foreground">Nothing matches these filters.</p>
          : <TxnTable bare rows={visible} matches={matches} view="net" sort={sort} onSort={setSort} notes={notes} />}
      </section>
    </>
  );
}
