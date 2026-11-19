import Link from "next/link";
import { cn } from "@/lib/utils";
import { dollars } from "@/lib/format";

/** Segmented button look shared by the range and average pickers. */
export const toggleCls = (on: boolean, first: boolean) =>
  cn("px-3 py-1.5 no-underline", !first && "border-l border-input",
    on ? "bg-primary text-primary-foreground hover:text-primary-foreground" : "bg-card text-ink-2 hover:bg-hairline hover:text-ink-2");

export interface Stat {
  label: string; value: number; tone?: "spend" | "income";
  note?: string;          // one short line under the value, e.g. "23% of income"
  avg: number; avgNote?: string;
  /** Compare against the average (only when the month is finished). "up" is good for income/saved, bad for spending. */
  compare?: "higher-is-good" | "higher-is-bad";
}

/** Invested, and what that left in cash (or took from it). */
export function investedNote(saved: number, invested: number) {
  const cash = saved - invested;
  return cash >= 0 ? `${dollars(cash)} kept in cash` : `${dollars(-cash)} drawn from cash`;
}

/** This month as a filled bar, the average as a dark tick on the same scale. */
function Compare({ value, avg, tone }: { value: number; avg: number; tone?: Stat["tone"] }) {
  if (value < 0 || avg <= 0) return null;
  const max = Math.max(value, avg);
  const fill = tone === "spend" ? "bg-spend" : tone === "income" ? "bg-income" : "bg-primary";
  return (
    <div className="relative h-2 w-full rounded-full bg-hairline" role="img" aria-label={`This month ${dollars(value)}, average ${dollars(avg)}`}>
      <div className={cn("h-2 rounded-full", fill)} style={{ width: `${(value / max) * 100}%` }} />
      <div className="absolute -top-1 h-4 w-0.5 rounded-full bg-foreground" style={{ left: `calc(${(avg / max) * 100}% - 1px)` }} title={`Average ${dollars(avg)}`} />
    </div>
  );
}

function Delta({ value, avg, compare }: { value: number; avg: number; compare: NonNullable<Stat["compare"]> }) {
  if (!avg) return null;
  const pct = Math.round(((value - avg) / Math.abs(avg)) * 100);
  if (pct === 0) return <span className="text-muted-foreground">same as avg</span>;
  const good = compare === "higher-is-good" ? pct > 0 : pct < 0;
  return <span className={good ? "text-income-ink" : "text-warn"}>{pct > 0 ? "↑" : "↓"} {Math.abs(pct)}% vs avg</span>;
}

/**
 * The chosen month in four self-contained tiles. Each tile shows its own average right underneath, so nothing has to be
 * looked up in another row. The average is always the N full months before the chosen month, so the month picker drives
 * everything; the 6 / 12 switch only picks N.
 */
export function Summary({ title, finished, stats, avgMonths, href }: {
  title: string; finished: boolean; stats: Stat[]; avgMonths: number; href: (n: number) => string;
}) {
  return (
    <section aria-label="Month summary" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {title ? <h3 className="text-base font-semibold">{title}</h3> : <span />}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Avg of the</span>
          <div role="group" aria-label="Average over" className="flex overflow-hidden rounded-md border border-input font-semibold">
            {[6, 12].map((n, i) => (
              <Link key={n} scroll={false} aria-pressed={avgMonths === n} href={href(n)}
                className={cn(toggleCls(avgMonths === n, i === 0), "px-2.5 py-1")}>{n} mo</Link>
            ))}
          </div>
          <span>before</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-card p-4">
            <span className="text-[13px] text-muted-foreground">{s.label}</span>
            <span className={cn("font-heading text-[24px] font-semibold leading-tight md:text-[28px]",
              s.tone === "spend" && "text-[#B45309]", s.tone === "income" && "text-income-ink")}><span className="sensitive">{dollars(s.value)}</span></span>
            {s.note && <span className="text-xs text-muted-foreground">{s.note}</span>}
            <div className="mt-auto flex flex-col gap-1.5 border-t border-hairline pt-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="whitespace-nowrap text-xs text-muted-foreground">{avgMonths}-mo avg</span>
                <span className="sensitive text-right text-[17px] font-semibold tabular-nums">{dollars(s.avg)}</span>
              </div>
              <Compare value={s.value} avg={s.avg} tone={s.tone} />
              {(s.avgNote || (finished && s.compare)) && (
                <div className="flex flex-wrap justify-between gap-x-2 text-xs">
                  <span className="text-muted-foreground">{s.avgNote}</span>
                  {finished && s.compare && <Delta value={s.value} avg={s.avg} compare={s.compare} />}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
