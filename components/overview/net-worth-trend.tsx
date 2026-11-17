import { dollars } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TrendPoint } from "@/lib/networth";

const W = 640, H = 170, base = 150;
const compact = (cents: number) => {
  const d = cents / 100;
  return Math.abs(d) >= 1_000_000 ? `$${(d / 1_000_000).toFixed(2)}M` : `$${(d / 1000).toFixed(1)}k`;
};
const label = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
/** Short axis label that still fits with 8 or more quarters: "Dec '24". */
const axis = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short" }) + " \u2019" + iso.slice(2, 4);

/** Quarter-end net worth: one marker per quarter with its value above and its date below. */
export default function NetWorthTrend({ points }: { points: TrendPoint[] }) {
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.abs(hi) || 1;
  const x = (i: number) => 40 + (i / Math.max(1, points.length - 1)) * (W - 80);
  const y = (v: number) => 120 - ((v - lo) / span) * 80;
  const xy = points.map((p, i) => [x(i), y(p.value)] as const);
  // On phones, with many quarters, label every other point (always the latest) so labels don't overlap.
  const quiet = (i: number) => points.length > 4 && (points.length - 1 - i) % 2 === 1 ? "max-md:hidden" : "";
  const line = xy.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
  const area = `M${xy[0][0]},${base} L${xy.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(" L")} L${xy[xy.length - 1][0]},${base} Z`;
  return (
    <>
      <div className="relative h-[170px]">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
          aria-label={`Net worth at each quarter end: ${points.map((p) => `${label(p.date)} ${dollars(p.value)}`).join(", ")}`}
          className="absolute inset-0 block h-[170px] w-full">
          <line x1="0" y1={base} x2={W} y2={base} stroke="var(--border)" strokeWidth="1" />
          <path d={area} fill="var(--brand-soft)" />
          <polyline points={line} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => (
          <div key={p.date}>
            <span aria-hidden="true" className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-brand bg-card"
              style={{ left: `${(xy[i][0] / W) * 100}%`, top: `${(xy[i][1] / H) * 100}%` }} />
            <span className={cn("absolute -translate-x-1/2 -translate-y-[30px] whitespace-nowrap text-xs font-semibold", quiet(i))}
              style={{ left: `${(xy[i][0] / W) * 100}%`, top: `${(xy[i][1] / H) * 100}%` }}>{compact(p.value)}</span>
          </div>
        ))}
      </div>
      <div className="relative h-4">
        {points.map((p, i) => (
          <span key={p.date} className={cn("absolute -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground", quiet(i))}
            style={{ left: `${(xy[i][0] / W) * 100}%` }} title={label(p.date)}>{axis(p.date)}</span>
        ))}
      </div>
    </>
  );
}
