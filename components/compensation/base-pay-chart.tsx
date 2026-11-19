import { cn } from "@/lib/utils";
import { dollars } from "@/lib/format";

export interface BasePayStep { date: string; annual: number; reason: string; pct: number | null }

const REASONS: Record<string, string> = {
  NH: "New hire", MER: "Merit", PRO: "Promotion", COL: "Cost of living", MKT: "Market adjustment", EQ: "Equity adjustment",
};

/** HR rows → one step per real change. Same-day changes merge; pay-period-only changes (same annual) are skipped. */
export function toSteps(rows: { effective_date: string; reason: string | null; annual: number | null }[]): BasePayStep[] {
  const sorted = rows.filter((r) => r.annual != null).sort((a, b) => a.effective_date.localeCompare(b.effective_date) || a.annual! - b.annual!);
  const steps: BasePayStep[] = [];
  for (const r of sorted) {
    const code = (r.reason ?? "").split(" - ")[0].trim();
    const label = REASONS[code] ?? (r.reason?.split(" - ")[1] ?? "Change");
    const last = steps[steps.length - 1];
    if (last && last.date === r.effective_date) {
      // Two changes on one day (e.g. merit + promotion): one step, both reasons
      last.annual = r.annual!;
      last.reason = `${last.reason} + ${label.toLowerCase()}`;
      continue;
    }
    if (last && Math.abs(r.annual! - last.annual) / last.annual < 0.001) continue;
    steps.push({ date: r.effective_date, annual: r.annual!, reason: label, pct: null });
  }
  for (let i = 1; i < steps.length; i++) steps[i].pct = ((steps[i].annual - steps[i - 1].annual) / steps[i - 1].annual) * 100;
  return steps;
}

const W = 720, H = 220, TOP = 46, BOTTOM = 160;
const k = (c: number) => `$${(c / 100_000).toFixed(1)}k`;
const monthYear = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short" }) + " ’" + iso.slice(2, 4);
const days = (iso: string) => Date.parse(iso + "T00:00:00") / 86_400_000;

/** CP-14: base salary over time as a step line, every raise labeled with the new salary, date, % and reason. */
export default function BasePayChart({ steps, today }: { steps: BasePayStep[]; today: string }) {
  if (steps.length < 2) return null;
  const first = steps[0], last = steps[steps.length - 1];
  const t0 = days(first.date), t1 = days(today);
  const x = (iso: string) => 24 + ((days(iso) - t0) / (t1 - t0)) * (W - 72);
  const lo = first.annual * 0.92, hi = last.annual * 1.03;
  const y = (v: number) => BOTTOM - ((v - lo) / (hi - lo)) * (BOTTOM - TOP);
  const pts = steps.map((s) => ({ ...s, px: x(s.date), py: y(s.annual) }));
  // Step path: flat until the next change, then up
  let d = `M${pts[0].px},${pts[0].py}`;
  for (let i = 1; i < pts.length; i++) d += ` H${pts[i].px} V${pts[i].py}`;
  d += ` H${x(today)}`;
  const area = `${d} V${BOTTOM} H${pts[0].px} Z`;
  const growth = ((last.annual - first.annual) / first.annual) * 100;
  const years = (days(today) - t0) / 365.25;
  const yearly = (Math.pow(last.annual / first.annual, 1 / ((days(last.date) - t0) / 365.25)) - 1) * 100;

  return (
    <section aria-label="Base salary history" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Base salary history</h2>
        <span className="text-xs text-muted-foreground">
          {dollars(first.annual)} → {dollars(last.annual)} · +{growth.toFixed(1)}% in {years.toFixed(1)} years · ≈ {yearly.toFixed(1)}% a year
        </span>
      </div>
      <div className="relative h-[220px]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" className="absolute inset-0 h-[220px] w-full"
          aria-label={`Base salary: ${steps.map((s) => `${monthYear(s.date)} ${dollars(s.annual)}${s.pct != null ? ` (+${s.pct.toFixed(1)}%)` : ""}`).join(", ")}`}>
          <line x1="0" y1={BOTTOM} x2={W} y2={BOTTOM} stroke="var(--border)" strokeWidth="1" />
          <path d={area} fill="var(--brand-soft)" />
          <path d={d} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {pts.map((p, i) => (
          <div key={p.date} title={`${monthYear(p.date)}: ${dollars(p.annual)}${p.pct != null ? `, +${p.pct.toFixed(1)}%` : ""} · ${p.reason}`}>
            <span aria-hidden="true" className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-brand bg-card"
              style={{ left: `${(p.px / W) * 100}%`, top: `${(p.py / H) * 100}%` }} />
            {/* Value above the point; % and reason under the axis date */}
            <span className="absolute -translate-x-1/2 -translate-y-[30px] whitespace-nowrap text-xs font-semibold"
              style={{ left: `${(p.px / W) * 100}%`, top: `${(p.py / H) * 100}%` }}>{k(p.annual)}</span>
            <span className={cn("absolute flex flex-col whitespace-nowrap leading-tight",
                i === 0 ? "-translate-x-[6px] items-start text-left" : "-translate-x-1/2 items-center text-center",
                // On phones, a change that's soon followed by another hides its labels so they don't collide
                pts[i + 1] && (pts[i + 1].px - p.px) / W < 0.14 && "max-sm:hidden")}
              style={{ left: `${(p.px / W) * 100}%`, top: `${((BOTTOM + 8) / H) * 100}%` }}>
              <span className="text-[11px] text-muted-foreground">{monthYear(p.date)}</span>
              <span className={cn("text-[11px] font-semibold", p.pct != null ? "text-income-ink" : "text-ink-2")}>
                {p.pct != null ? `+${p.pct.toFixed(1)}%` : "Start"}
              </span>
              <span className="text-[10px] text-muted-foreground max-sm:hidden">{p.reason}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
