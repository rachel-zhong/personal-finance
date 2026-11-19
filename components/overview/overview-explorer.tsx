"use client";
import { useMemo, useState, type ReactNode } from "react";
import { Heart, Hourglass, Landmark, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import AccountsPanel, { PanelGroup } from "./accounts-panel";

export type CardKey = "cash" | "invest" | "retire" | "held";

const ICONS = {
  cash: { Icon: Landmark, bg: "#E3F1EE", fg: "#0B5246" },
  invest: { Icon: TrendingUp, bg: "#DBEAFE", fg: "#1D4ED8" },
  retire: { Icon: Hourglass, bg: "#FEF3C7", fg: "#92400E" },
  held: { Icon: Heart, bg: "#EDE9FE", fg: "#5B21B6" },
};

export interface SummaryCardData { key: CardKey; label: string; value: string; note: string }

/**
 * The four summary cards are filters: tap one and the accounts list shows only those accounts,
 * with every bank opened. Tap it again (or "Show all") to go back.
 */
export default function OverviewExplorer({ cards, groups, recent }: { cards: SummaryCardData[]; groups: PanelGroup[]; recent: ReactNode }) {
  const [sel, setSel] = useState<CardKey | null>(null);
  const toggle = (k: CardKey) => setSel((s) => (s === k ? null : k));

  const shown = useMemo<PanelGroup[]>(() => {
    if (!sel) return groups;
    if (sel !== "held") return groups.filter((g) => g.key === sel);
    // Held for others: only accounts with money set aside, totals show the held amount
    return groups.map((g) => {
      const banks = g.banks
        .map((b) => {
          const items = b.items.filter((a) => a.heldAmount > 0);
          return { ...b, items, total: items.reduce((s, a) => s + a.heldAmount, 0) };
        })
        .filter((b) => b.items.length);
      return { ...g, banks, hidden: 0, total: banks.reduce((s, b) => s + b.total, 0) };
    }).filter((g) => g.banks.length);
  }, [groups, sel]);
  const label = sel ? cards.find((c) => c.key === sel)!.label : null;

  return (
    <>
      <div role="group" aria-label="Filter accounts" className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4">
        {cards.map((c) => {
          const { Icon, bg, fg } = ICONS[c.key];
          const on = sel === c.key;
          return (
            <button key={c.key} type="button" aria-pressed={on} onClick={() => toggle(c.key)}
              title={on ? "Tap again to show all accounts" : `Show only ${c.label.toLowerCase()} accounts`}
              className={cn("flex items-start gap-3.5 rounded-xl bg-card p-[18px] text-left transition-colors hover:bg-field",
                c.key === "held" && !on ? "border border-dashed border-input" : "border",
                on ? "border-primary ring-2 ring-primary/25" : sel ? "border-border opacity-70 hover:opacity-100" : "border-border")}>
              <span className="flex size-10 flex-none items-center justify-center rounded-[10px]" style={{ background: bg, color: fg }}>
                <Icon className="size-5" strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[13px] text-muted-foreground">{c.label}</span>
                <span className="sensitive font-heading text-[26px] font-semibold">{c.value}</span>
                <span className="text-xs text-muted-foreground">{c.note}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Accounts a little over half the width; recent transactions take the rest */}
      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[11fr_9fr]">
        <AccountsPanel groups={shown} filterLabel={label} onClear={() => setSel(null)} expandKey={sel} />
        <div className="flex min-w-0 flex-col [&>*]:flex-1">{recent}</div>
      </div>
    </>
  );
}
