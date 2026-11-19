import { AlertTriangle } from "lucide-react";
import { dollars } from "@/lib/format";
import type { CombinedHolding } from "@/lib/holdings";

const LIMIT = 10; // % of the total

/**
 * IN-11: the 10 biggest holdings as a share of everything. A single company (or coin) over 10% is flagged;
 * funds and whole-account lines are already spread out, so they're shown but not flagged.
 */
export default function Concentration({ rows, total }: { rows: CombinedHolding[]; total: number }) {
  const top = rows.filter((r) => r.assetType !== "cash").slice(0, 10);
  const single = (r: CombinedHolding) => r.assetType === "stocks" || r.assetType === "crypto";
  const flagged = top.filter((r) => single(r) && total && (r.value / total) * 100 > LIMIT);
  const max = Math.max(...top.map((r) => r.value), 1);
  return (
    <section aria-label="Concentration" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Top 10 holdings</h2>
        <span className="text-xs text-muted-foreground">
          {flagged.length ? `${flagged.length} single holding${flagged.length === 1 ? "" : "s"} over ${LIMIT}%` : `No single stock over ${LIMIT}%`}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {top.map((r) => {
          const pct = total ? (r.value / total) * 100 : 0;
          const flag = single(r) && pct > LIMIT;
          return (
            <div key={r.key} className="flex flex-col gap-1.5 py-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{r.ticker ?? r.name}</span>
                  {flag && (
                    <span className="flex flex-none items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">
                      <AlertTriangle className="size-3" aria-hidden="true" />Over {LIMIT}%
                    </span>
                  )}
                </span>
                <span className="flex-none tabular-nums"><span className="font-semibold">{dollars(r.value)}</span>
                  <span className="ml-2 inline-block w-12 text-right text-muted-foreground">{pct.toFixed(pct < 1 ? 1 : 0)}%</span></span>
              </div>
              <div className="relative h-2 w-full rounded-full bg-hairline">
                <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(0.5, (r.value / max) * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Flags single stocks and crypto over {LIMIT}% of the total. Funds and whole accounts are already spread out.</p>
    </section>
  );
}
