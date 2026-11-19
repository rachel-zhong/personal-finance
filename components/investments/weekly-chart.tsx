"use client";
import { useState } from "react";
import { dollars } from "@/lib/format";
import type { WeekPoint } from "@/lib/investments";

const W = 600, H = 140, TOP = 14, BOTTOM = 118;
const day = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const compact = (cents: number) => {
  const d = cents / 100;
  return Math.abs(d) >= 1_000_000 ? `$${(d / 1_000_000).toFixed(2)}M` : `$${Math.round(d / 1000)}k`;
};

/**
 * Weekly total value: the last saved value in each week. Weeks without a saved value are a gap,
 * never filled in. Hover (or tap) a point for its value.
 */
export default function WeeklyChart({ weeks }: { weeks: WeekPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const known = weeks.filter((w) => w.value != null) as (WeekPoint & { value: number })[];
  if (known.length < 2) {
    // One saved week so far: show it as a single point, and when the line starts.
    const first = known[0];
    const nextWeek = first ? new Date(first.weekEnd + "T00:00:00") : null;
    nextWeek?.setDate(nextWeek.getDate() + 1);
    return (
      <div className="flex h-[140px] flex-col justify-end gap-2">
        <div className="relative border-b border-dashed border-input">
          {first && (
            <div className="absolute -top-[5px] right-2 flex items-center gap-2">
              <span className="sensitive text-xs font-semibold tabular-nums">{dollars(first.value)}</span>
              <span className="size-2.5 rounded-full border-2 border-card bg-primary ring-1 ring-primary" />
            </div>
          )}
        </div>
        <p className="text-[11px] text-[#8A8A93]">
          {first?.date
            ? `One value a week, saved from ${day(first.date)}. The line starts from the week of ${day(nextWeek!.toISOString().slice(0, 10))}. Brokers don't share past values, so there's nothing earlier.`
            : "One value a week, saved each time you sync."}
        </p>
      </div>
    );
  }
  const vals = known.map((w) => w.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.02 || 1;
  const y = (v: number) => BOTTOM - ((v - (lo - pad)) / (hi + pad - (lo - pad))) * (BOTTOM - TOP);
  const x = (i: number) => 8 + (i / Math.max(1, weeks.length - 1)) * (W - 16);

  // Consecutive weeks with a value form one segment; a missing week breaks the line.
  const segments: number[][] = [];
  weeks.forEach((w, i) => {
    if (w.value == null) return;
    const prev = segments[segments.length - 1];
    if (prev && prev[prev.length - 1] === i - 1) prev.push(i);
    else segments.push([i]);
  });
  const h = hover != null ? weeks[hover] : null;
  const labelIdx = [0, Math.floor((weeks.length - 1) / 2), weeks.length - 1].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      {/* Dots and tooltip are placed in % of this box, so it must be exactly the chart's height */}
      <div className="relative h-[140px]">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" className="block h-[140px] w-full"
        aria-label={`Weekly value: ${known.map((w) => `${day(w.date!)} ${dollars(w.value)}`).join(", ")}`}>
        <line x1="0" y1={BOTTOM} x2={W} y2={BOTTOM} stroke="var(--border)" strokeWidth="1" />
        {segments.map((seg, k) => (
          <polyline key={k} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
            points={seg.map((i) => `${x(i).toFixed(1)},${y(weeks[i].value!).toFixed(1)}`).join(" ")} />
        ))}
        {/* Wide invisible hit areas, one per week */}
        {weeks.map((w, i) => (
          <rect key={w.weekEnd} x={x(i) - W / weeks.length / 2} y={0} width={W / weeks.length} height={H} fill="transparent"
            onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
        ))}
      </svg>
      {weeks.map((w, i) => w.value != null && (
        <span key={w.weekEnd} aria-hidden="true"
          className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand bg-card ${hover === i ? "size-3" : "size-2"}`}
          style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(w.value) / H) * 100}%` }} />
      ))}
      {h && (
        <div className="pointer-events-none absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm"
          style={{ left: `${Math.min(85, Math.max(15, (x(hover!) / W) * 100))}%` }}>
          <span className="text-muted-foreground">Week of {day(shiftBack(h.weekEnd))}: </span>
          <span className="font-semibold">{h.value != null ? dollars(h.value) : "no value saved"}</span>
        </div>
      )}
      </div>
      <div className="relative mt-1 h-4">
        {labelIdx.map((i) => (
          <span key={i} className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground"
            style={{ left: `${Math.min(92, Math.max(8, (x(i) / W) * 100))}%` }}>{day(shiftBack(weeks[i].weekEnd))}</span>
        ))}
      </div>
      <span className="sr-only">Range {compact(lo)} to {compact(hi)}</span>
    </div>
  );
}

/** Monday that starts the week ending on `sunday`. */
function shiftBack(sunday: string) {
  const d = new Date(sunday + "T00:00:00");
  d.setDate(d.getDate() - 6);
  return d.toLocaleDateString("en-CA");
}
