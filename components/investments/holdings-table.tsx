"use client";
import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { dollars, money } from "@/lib/format";
import { ASSET_LABELS, ASSET_TYPES, accountFilters, combine, type AssetType, type CombinedHolding, type HoldingLine } from "@/lib/holdings";
import ManualHoldingForm, { type ManualAccount, type ManualHolding } from "./manual-holding-form";

type SortKey = "name" | "type" | "quantity" | "price" | "value" | "pct" | "basis" | "gain";
const COLS: { key: SortKey; label: string; right?: boolean }[] = [
  { key: "name", label: "Holding" },
  { key: "type", label: "Type" },
  { key: "quantity", label: "Shares", right: true },
  { key: "price", label: "Price", right: true },
  { key: "value", label: "Value", right: true },
  { key: "pct", label: "% of total", right: true },
  { key: "basis", label: "Cost basis", right: true },
  { key: "gain", label: "Gain", right: true },
];
const GRID = "grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 md:grid-cols-[minmax(0,2.2fr)_1fr_0.8fr_0.9fr_1fr_0.7fr_1fr_1.2fr]";

const gainOf = (h: CombinedHolding) => (h.costBasis == null ? null : h.value - h.costBasis);
const shares = (q: number | null) => (q == null ? "—" : q.toLocaleString("en-US", { maximumFractionDigits: q < 10 ? 4 : 2 }));
const price = (p: number | null) => (p == null ? "—" : money(Math.round(p * 100)));

function Gain({ h }: { h: CombinedHolding }) {
  const g = h.assetType === "cash" ? null : gainOf(h);
  if (g == null) return <span className="text-muted-foreground">—</span>;
  const pct = h.costBasis ? (g / h.costBasis) * 100 : null;
  return (
    <span className={cn("tabular-nums", g > 0 ? "text-income-ink" : g < 0 ? "text-warn" : "text-muted-foreground")}>
      {g > 0 ? "+" : g < 0 ? "−" : ""}{dollars(Math.abs(g))}{pct != null && <span className="text-xs"> ({pct >= 0 ? "+" : "−"}{Math.abs(pct).toFixed(1)}%)</span>}
      {h.costBasisPartial && <span className="text-xs text-muted-foreground"> partial</span>}
    </span>
  );
}

/** Type: one segmented control (pick one kind of holding). */
const seg = (on: boolean, first: boolean) => cn("min-h-9 whitespace-nowrap px-3 text-[13px] font-semibold", !first && "border-l border-input",
  on ? "bg-primary text-primary-foreground" : "bg-card text-ink-2 hover:bg-hairline");
/** Account: separate rounded chips with their value, so they read as a different kind of filter. */
const chip = (on: boolean) => cn("flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px]",
  on ? "border-primary bg-accent font-semibold text-accent-foreground" : "border-input bg-card text-ink-2 hover:bg-hairline");
const FILTER_LABEL = "flex-none text-xs md:w-16 md:pt-2.5 font-semibold uppercase tracking-[0.04em] text-muted-foreground";

/**
 * IN-12 / IN-13: one row per security across accounts, filtered by type and account.
 * Click a row to see which accounts hold it. Holdings you added by hand can be edited there (IN-7).
 */
export default function HoldingsTable({ lines, total, manualAccounts, manualHoldings }: {
  lines: HoldingLine[]; total: number; manualAccounts: ManualAccount[]; manualHoldings: ManualHolding[];
}) {
  const typeLabels: Record<string, string> = ASSET_LABELS;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "value", dir: -1 });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [type, setType] = useState<AssetType | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManualHolding | "new" | null>(null);

  const accounts = useMemo(() => accountFilters(lines), [lines]);
  const picked = accounts.find((a) => a.key === account);
  const inAccount = useMemo(() => lines.filter((l) => !picked || picked.accountIds.includes(l.accountId)), [lines, picked]);
  const types = ASSET_TYPES.map((t) => ({ t, n: combine(inAccount.filter((l) => l.assetType === t)).length })).filter((x) => x.n);
  const rows = useMemo(() => combine(inAccount.filter((l) => !type || l.assetType === type)), [inAccount, type]);
  const shownValue = rows.reduce((s, r) => s + r.value, 0);
  // Subtotal of what's shown: gain only over holdings with a cost basis (cash has none to gain on)
  const withBasis = rows.filter((r) => r.assetType !== "cash" && r.costBasis != null);
  const shownBasis = withBasis.reduce((s, r) => s + (r.costBasis ?? 0), 0);
  const shownGain = withBasis.reduce((s, r) => s + r.value - (r.costBasis ?? 0), 0);
  const filtered = !!(type || account);
  const sorted = useMemo(() => {
    const v = (h: CombinedHolding): string | number | null => {
      switch (sort.key) {
        case "name": return (h.ticker ?? h.name).toLowerCase();
        case "type": return typeLabels[h.assetType];
        case "quantity": return h.quantity;
        case "price": return h.price;
        case "value": case "pct": return h.value;
        case "basis": return h.costBasis;
        case "gain": return gainOf(h);
      }
    };
    return [...rows].sort((a, b) => {
      const x = v(a), y = v(b);
      if (x == null && y == null) return b.value - a.value;
      if (x == null) return 1; // blanks last either way
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, typeLabels]);
  const click = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "name" || key === "type" ? 1 : -1 }));
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <section aria-label="Holdings" className="flex min-w-0 flex-col rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Holdings</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Combined across accounts · click a row to see which accounts hold it
          </p>
        </div>
        {manualAccounts.length > 0 && (
          <button type="button" onClick={() => setEditing("new")} className="h-9 rounded-lg border border-input bg-card px-3 text-[13px] font-semibold text-ink-2 hover:bg-hairline">
            + Add a holding
          </button>
        )}
      </div>
      {editing && (
        <ManualHoldingForm accounts={manualAccounts} holding={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
      )}
      <div className="flex flex-col gap-2.5 px-5 pb-4">
        <div className="flex flex-col gap-1.5 md:flex-row md:gap-2">
          <span className={FILTER_LABEL}>Type</span>
          <div role="group" aria-label="Holding type" className="flex max-w-full overflow-x-auto rounded-lg border border-input">
            <button type="button" aria-pressed={!type} onClick={() => setType(null)} className={seg(!type, true)}>All</button>
            {types.map(({ t, n }) => (
              <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(type === t ? null : t)} className={seg(type === t, false)}>
                {ASSET_LABELS[t]} <span className="font-normal opacity-75">{n}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 md:flex-row md:gap-2">
          <span className={FILTER_LABEL}>Account</span>
          <div role="group" aria-label="Account" className="flex min-w-0 flex-wrap gap-1.5">
            <button type="button" aria-pressed={!account} onClick={() => setAccount(null)} className={chip(!account)}>All accounts</button>
            {accounts.map((a) => (
              <button key={a.key} type="button" aria-pressed={account === a.key} onClick={() => setAccount(account === a.key ? null : a.key)} className={chip(account === a.key)}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div role="row" className={cn(GRID, "hidden border-y border-border bg-field px-5 py-2 text-xs font-semibold text-muted-foreground md:grid")}>
        {COLS.map((c) => (
          <button key={c.key} type="button" onClick={() => click(c.key)} className={cn("tight flex items-center gap-1 hover:text-foreground", c.right && "justify-end")}>
            {c.label}{sort.key === c.key && <span aria-hidden="true">{sort.dir === 1 ? "↑" : "↓"}</span>}
          </button>
        ))}
      </div>
      {/* Phone: a sort picker instead of column headers */}
      <label className="flex items-center gap-2 border-t border-border px-5 py-2 text-[13px] font-semibold text-ink-2 md:hidden">
        Sort
        <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [k, d] = e.target.value.split(":"); setSort({ key: k as SortKey, dir: Number(d) as 1 | -1 }); }}
          className="h-9 rounded-lg border border-input bg-card px-2 text-[13px] font-normal text-foreground">
          <option value="value:-1">Value: high to low</option>
          <option value="value:1">Value: low to high</option>
          <option value="gain:-1">Gain: high to low</option>
          <option value="gain:1">Gain: low to high</option>
          <option value="name:1">Name: A to Z</option>
        </select>
      </label>
      {!sorted.length && <p className="border-t border-hairline px-5 py-6 text-sm text-muted-foreground">Nothing matches these filters.</p>}
      {sorted.map((h) => {
        const isOpen = open.has(h.key);
        const pct = total ? (h.value / total) * 100 : 0;
        return (
          <Fragment key={h.key}>
            <button type="button" aria-expanded={isOpen} onClick={() => toggle(h.key)}
              className={cn(GRID, "w-full gap-y-0.5 border-t border-hairline px-5 py-3 text-left text-sm hover:bg-hairline md:items-center")}>
              <span className="flex min-w-0 items-center gap-1.5">
                {isOpen ? <ChevronDown className="size-4 flex-none text-muted-foreground" /> : <ChevronRight className="size-4 flex-none text-muted-foreground" />}
                <span className="min-w-0">
                  <span className="block truncate font-medium">{h.ticker ?? h.name}</span>
                  {h.ticker && <span className="block truncate text-xs text-muted-foreground">{h.name}</span>}
                  {!h.ticker && h.note && <span className="block truncate text-xs text-muted-foreground">{h.note}</span>}
                </span>
              </span>
              <span className="hidden text-ink-2 md:block">{typeLabels[h.assetType]}</span>
              <span className="hidden text-right tabular-nums md:block">{shares(h.quantity)}</span>
              <span className="hidden text-right tabular-nums md:block">{price(h.price)}</span>
              <span className="text-right font-semibold tabular-nums">{dollars(h.value)}</span>
              <span className="hidden text-right tabular-nums text-ink-2 md:block">{pct.toFixed(pct < 1 ? 1 : 0)}%</span>
              <span className="hidden text-right tabular-nums md:block">{h.costBasis == null || h.assetType === "cash" ? <span className="text-muted-foreground">—</span> : dollars(h.costBasis)}</span>
              <span className="hidden text-right md:block"><Gain h={h} /></span>
              {/* Phone second line */}
              <span className="pl-[22px] text-xs text-muted-foreground md:hidden">
                {typeLabels[h.assetType]} · {pct.toFixed(pct < 1 ? 1 : 0)}%{h.quantity != null ? ` · ${shares(h.quantity)} sh` : ""}
              </span>
              <span className="text-right text-xs md:hidden"><Gain h={h} /></span>
            </button>
            {isOpen && (
              <div className="border-t border-hairline bg-field px-5 py-2 pl-[42px] text-[13px]">
                {h.accounts.map((a, i) => {
                  const mh = a.manualId ? manualHoldings.find((m) => m.id === a.manualId) : undefined;
                  return (
                    <div key={i} className="flex items-center justify-between gap-3 py-1">
                      <span className="min-w-0 truncate text-ink-2">{a.account}{mh && <span className="text-muted-foreground"> · added by hand</span>}</span>
                      <span className="flex flex-none items-center gap-3 tabular-nums">
                        {a.quantity != null ? <span className="text-muted-foreground">{shares(a.quantity)} sh</span> : null}{dollars(a.value)}
                        {mh && (
                          <button type="button" aria-label={`Edit ${mh.name}`} onClick={() => setEditing(mh)}
                            className="tight rounded p-1 text-muted-foreground hover:bg-hairline hover:text-foreground">
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Fragment>
        );
      })}
      {sorted.length > 0 && (
        <div className={cn(GRID, "gap-y-0.5 rounded-b-xl border-t-2 border-border bg-field px-5 py-3 text-sm font-semibold md:items-center")}>
          <span className="pl-[22px]">
            {filtered ? "Subtotal" : "Total"} <span className="font-normal text-muted-foreground">· {rows.length} holding{rows.length === 1 ? "" : "s"}</span>
          </span>
          <span className="hidden md:block" /><span className="hidden md:block" /><span className="hidden md:block" />
          <span className="sensitive text-right tabular-nums">{dollars(shownValue)}</span>
          <span className="hidden text-right tabular-nums text-ink-2 md:block">{total ? Math.round((shownValue / total) * 100) : 0}%</span>
          <span className="hidden text-right tabular-nums md:block">{withBasis.length ? dollars(shownBasis) : "—"}</span>
          <span className={cn("hidden text-right tabular-nums md:block", shownGain > 0 ? "text-income-ink" : shownGain < 0 ? "text-warn" : "text-muted-foreground")}>
            {withBasis.length ? `${shownGain > 0 ? "+" : shownGain < 0 ? "−" : ""}${dollars(Math.abs(shownGain))}` : "—"}
          </span>
          <span className="pl-[22px] text-xs font-normal text-muted-foreground md:hidden">{total ? Math.round((shownValue / total) * 100) : 0}% of all</span>
          <span className={cn("text-right text-xs md:hidden", shownGain > 0 ? "text-income-ink" : shownGain < 0 ? "text-warn" : "text-muted-foreground")}>
            {withBasis.length ? `${shownGain > 0 ? "+" : shownGain < 0 ? "−" : ""}${dollars(Math.abs(shownGain))}` : ""}
          </span>
        </div>
      )}
    </section>
  );
}
