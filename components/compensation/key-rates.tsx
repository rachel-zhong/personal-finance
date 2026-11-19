"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { dollars, shortDate } from "@/lib/format";

export interface RateTile { label: string; big: string; unit?: string; lines: string[] }
export interface KeyRatesData {
  tiles: RateTile[];
  takeHome?: { withBonus: number; withoutBonus: number; range: string; bonusAfterTax: number };
  changes: { date: string; text: string }[];
}

function Tile({ t, children }: { t: RateTile; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-4">
      <span className="text-[13px] text-muted-foreground">{t.label}</span>
      <span className="font-heading text-[24px] font-semibold leading-none"><span className="sensitive">{t.big}</span>{t.unit && <span className="ml-1 text-[13px] font-normal text-muted-foreground">{t.unit}</span>}</span>
      {children}
      <div className="flex flex-col gap-0.5 text-xs text-ink-2">{t.lines.map((l, i) => <span key={i}>{l}</span>)}</div>
    </div>
  );
}

/** The numbers worth checking every year: 401(k), HSA, tax rate, monthly take-home. */
export default function KeyRates({ d }: { d: KeyRatesData }) {
  const [noBonus, setNoBonus] = useState(false);
  const th = d.takeHome;
  return (
    <section aria-label="Your rates" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-base font-semibold">Your rates</h2>
      <div className={cn("grid grid-cols-2 gap-3 md:gap-4", d.tiles.length + (th ? 1 : 0) >= 4 ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
        {d.tiles.map((t) => <Tile key={t.label} t={t} />)}
        {th && (
          <Tile t={{ label: "Monthly take-home", big: dollars(noBonus ? th.withoutBonus : th.withBonus), unit: "avg",
            lines: ["Completed months only"] }}>
            {th.bonusAfterTax > 0 && (
              <label className="flex w-fit cursor-pointer items-center gap-2 py-1 text-xs font-semibold text-ink-2">
                <button type="button" role="switch" aria-checked={noBonus} onClick={() => setNoBonus(!noBonus)}
                  className={cn("tight relative h-5 w-9 flex-none rounded-full transition-colors", noBonus ? "bg-primary" : "bg-input")}>
                  <span className={cn("absolute top-0.5 size-4 rounded-full bg-card shadow transition-all", noBonus ? "left-[18px]" : "left-0.5")} />
                </button>
                Without one-time bonus
              </label>
            )}
          </Tile>
        )}
      </div>
      {d.changes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-ink-2">Changes: </span>
          {d.changes.map((c) => `${shortDate(c.date).replace(/, \d{4}$/, "")} ${c.text}`).join(" · ")}
        </p>
      )}
    </section>
  );
}
