import Link from "next/link";
import { cn } from "@/lib/utils";
import { dollars } from "@/lib/format";

/** Segmented button look shared by the range and average pickers. */
export const toggleCls = (on: boolean, first: boolean) =>
  cn("px-3 py-1.5 no-underline", !first && "border-l border-input",
    on ? "bg-primary text-primary-foreground hover:text-primary-foreground" : "bg-card text-ink-2 hover:bg-hairline hover:text-ink-2");

export interface Stat { label: string; value: string; unit?: string; sub: string; tone?: "spend" | "income" }

/** "Where it went": what you saved, split into money moved to investments and money left in (or drawn from) cash. */
export function whereItWent(saved: number, invested: number, perMonth = false): Stat {
  const cash = saved - invested;
  const share = saved > 0 && cash >= 0 ? ` · ${Math.round((invested / saved) * 100)}% invested` : "";
  return {
    label: "Where it went", value: dollars(invested), unit: "invested",
    sub: cash >= 0 ? `${dollars(cash)} kept in cash${share}` : `Drew ${dollars(-cash)}${perMonth ? " a month" : ""} from cash`,
  };
}

/**
 * One card, two aligned rows: the month on top, the average month underneath, same four columns
 * (Net spending · Income · Saved · Where it went), so each average sits right under the number it compares to.
 */
export function Summary({ monthLabel, month, average, averageLabel, avgMonths, href }: {
  monthLabel: string; month: Stat[]; average: Stat[]; averageLabel: string; avgMonths: number; href: (n: number) => string;
}) {
  const rowLabel = "px-5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground";
  return (
    <section aria-label="Summary" className="flex flex-col rounded-xl border border-border bg-card">
      <h2 className="px-5 pb-1 pt-4 text-base font-semibold">Summary</h2>

      <p className={cn(rowLabel, "pt-3")}>{monthLabel}</p>
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {month.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-col gap-1 px-5 pb-4 pt-2">
            <span className="text-[13px] text-muted-foreground">{s.label}</span>
            <span className={cn("font-heading text-[28px] font-semibold leading-tight",
              s.tone === "spend" && "text-[#B45309]", s.tone === "income" && "text-income-ink")}>
              {s.value}{s.unit && <span className="ml-1.5 font-sans text-sm font-medium text-muted-foreground">{s.unit}</span>}
            </span>
            <span className="text-xs text-muted-foreground">{s.sub}</span>
          </div>
        ))}
      </div>

      <div className="mx-5 border-t border-hairline" />
      {/* The 6 / 12 month switch sits on the average row, because that's the only row it changes */}
      <div className="flex flex-wrap items-center justify-between gap-2 pr-5 pt-3">
        <p className={rowLabel}>{averageLabel}</p>
        <div role="group" aria-label="Average over" className="flex overflow-hidden rounded-md border border-input text-xs font-semibold">
          {[6, 12].map((n, i) => (
            <Link key={n} scroll={false} aria-pressed={avgMonths === n} href={href(n)}
              className={cn(toggleCls(avgMonths === n, i === 0), "px-2.5 py-1")}>{n} mo</Link>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4">
        {average.map((s) => (
          <div key={s.label} className="flex min-w-0 flex-col gap-0.5 px-5 pb-4 pt-1.5">
            <span className="text-[13px] text-muted-foreground lg:hidden">{s.label}</span>
            <span className="text-lg font-semibold">
              {s.value}{s.unit && <span className="ml-1.5 text-[13px] font-medium text-muted-foreground">{s.unit}</span>}
            </span>
            <span className="text-xs text-muted-foreground">{s.sub}</span>
          </div>
        ))}
      </div>
      <p className="border-t border-hairline px-5 py-2.5 text-[11px] text-[#8A8A93]">
        Where it went splits what you saved into money moved to investments and money left in cash. Excluded transactions don&apos;t count.
      </p>
    </section>
  );
}
