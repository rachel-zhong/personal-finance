"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { dollars, money } from "@/lib/format";
import { toggleCls } from "@/components/spending/averages";

export interface FlowSegment { key: string; label: string; amount: number; color: string; lines: { label: string; amount: number }[]; pattern?: boolean }
export interface FlowView {
  key: string; label: string; title: string;
  cashGross: number; cashLines: { label: string; amount: number }[];
  segments: FlowSegment[];            // taxes, benefits, retirement, other, take-home — they add up to cashGross
  added: { label: string; amount: number }[];
  deposited: number;
  rsu: { title: string; income: number; taxes: number; kept: number; lines: { label: string; amount: number }[] } | null;
  sameScale: boolean;                 // draw the RSU bar to the same $ scale as cash (only when both cover the same period)
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const HATCH = "repeating-linear-gradient(45deg,var(--hairline) 0 4px,var(--input) 4px 6px)";

/** One bar plus its rows (legend and drill-down). Percentages are of this bar's own total. */
function Block({ id, title, total, segments, width, open, toggle }: {
  id: string; title: React.ReactNode; total: number; segments: FlowSegment[]; width: number;
  open: Set<string>; toggle: (k: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = segments.filter((s) => s.amount > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <span className="sensitive font-heading text-[20px] font-semibold tabular-nums md:text-[22px]">{dollars(total)}</span>
      </div>
      <div className="relative" onMouseLeave={() => setHover(null)}>
        <div className="flex h-9 gap-[2px] overflow-hidden rounded-[4px]" style={{ width: `${Math.max(width, 8)}%` }}>
          {shown.map((s) => {
            const share = s.amount / total;
            const dark = s.key === "takehome" || s.key === "retirement";
            return (
              <button key={s.key} type="button" aria-label={`${s.label}: ${dollars(s.amount)}, ${pct(s.amount, total)}. Show details.`}
                onMouseEnter={() => setHover(s.key)} onFocus={() => setHover(s.key)} onBlur={() => setHover(null)}
                onClick={() => s.lines.length && toggle(`${id}:${s.key}`)}
                className={cn("tight flex min-w-[3px] items-center justify-center overflow-hidden text-[11px] font-semibold transition-opacity",
                  hover && hover !== s.key && "opacity-45", dark ? "text-white" : "text-[#1F1F23]")}
                style={{ width: `${share * 100}%`, background: s.pattern ? HATCH : s.color }}>
                {share * width >= 7 && pct(s.amount, total)}
              </button>
            );
          })}
        </div>
        {hover && (() => {
          const i = shown.findIndex((s) => s.key === hover);
          if (i < 0) return null;
          const start = shown.slice(0, i).reduce((t, s) => t + s.amount, 0);
          const mid = (((start + shown[i].amount / 2) / total) * width);
          return (
            <div role="tooltip" className="pointer-events-none absolute top-11 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-sm"
              style={{ left: `${Math.min(85, Math.max(15, mid))}%` }}>
              <span className="font-semibold">{shown[i].label}</span>
              <span className="ml-2 tabular-nums">{dollars(shown[i].amount)}</span>
              <span className="ml-1.5 text-muted-foreground">{pct(shown[i].amount, total)}</span>
            </div>
          );
        })()}
      </div>
      <div className="flex flex-col">
        {segments.map((s) => {
          const key = `${id}:${s.key}`;
          const isOpen = open.has(key);
          const strong = s.key === "takehome" || s.key === "kept";
          return (
            <div key={s.key} className={cn("border-t border-hairline transition-colors", hover === s.key && "bg-hairline")}>
              <button type="button" aria-expanded={isOpen} onClick={() => s.lines.length && toggle(key)}
                onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}
                className={cn("flex w-full items-center gap-2.5 py-2.5 text-left text-sm", s.lines.length ? "hover:bg-hairline" : "cursor-default")}>
                {s.lines.length
                  ? (isOpen ? <ChevronDown className="size-4 flex-none text-muted-foreground" /> : <ChevronRight className="size-4 flex-none text-muted-foreground" />)
                  : <span className="size-4 flex-none" />}
                <span aria-hidden="true" className="size-2.5 flex-none rounded-[2px]" style={{ background: s.pattern ? HATCH : s.color }} />
                <span className={cn("min-w-0 flex-1", strong && "font-semibold")}>{s.label}</span>
                <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{pct(s.amount, total)}</span>
                <span className={cn("w-24 text-right tabular-nums", s.key === "takehome" ? "font-semibold text-income-ink" : strong ? "font-semibold" : "font-medium")}>{dollars(s.amount)}</span>
              </button>
              {isOpen && (
                <div className="mb-2 ml-[46px] flex flex-col text-[13px]">
                  {s.lines.map((l) => (
                    <div key={l.label} className="flex items-baseline gap-3 py-0.5 text-ink-2">
                      <span className="min-w-0 flex-1 truncate">{l.label}</span>
                      <span className="w-14 flex-none text-right text-xs tabular-nums text-muted-foreground">{pct(l.amount, total)}</span>
                      <span className="w-24 flex-none text-right tabular-nums">{money(l.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * CP-7: where pay goes, cash and RSU stock as two separate bars. Each bar's percentages are of its own total.
 * For the year view both bars share one $ scale, so the RSU bar's length shows its size next to cash.
 * Hover a segment for details; click a segment or row to open its line items.
 */
export default function PaycheckFlow({ views }: { views: FlowView[] }) {
  const [viewKey, setViewKey] = useState(views[0]?.key);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const v = views.find((x) => x.key === viewKey) ?? views[0];
  if (!v) return null;
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const scale = v.rsu && v.sameScale ? Math.max(v.cashGross, v.rsu.income) : 0;
  const w = (amt: number) => (scale ? (amt / scale) * 100 : 100);

  return (
    <section aria-label="Where my pay goes" className="flex min-w-0 flex-col gap-5 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Where my pay goes</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{v.title}</p>
        </div>
        <div role="group" aria-label="Period" className="flex overflow-hidden rounded-md border border-input text-[13px] font-semibold">
          {views.map((x, i) => (
            <button key={x.key} type="button" aria-pressed={x.key === v.key} onClick={() => setViewKey(x.key)} className={toggleCls(x.key === v.key, i === 0)}>{x.label}</button>
          ))}
        </div>
      </div>

      <Block id={`${v.key}-cash`} title="Cash pay" total={v.cashGross} segments={v.segments} width={w(v.cashGross)} open={open} toggle={toggle} />
      {v.added.length > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground">Also deposited: {v.added.map((a) => `${a.label} ${dollars(a.amount)}`).join(" · ")}</p>
      )}

      {v.rsu && (
        <div className="border-t border-border pt-4">
          <Block id={`${v.key}-rsu`} total={v.rsu.income} width={w(v.rsu.income)} open={open} toggle={toggle}
            title={<>RSU stock <span className="font-normal text-muted-foreground">· {v.rsu.title}</span></>}
            segments={[
              { key: "taxes", label: "Taxes, paid with shares", amount: v.rsu.taxes, color: "#F08A3C", lines: v.rsu.lines },
              { key: "kept", label: "Kept as shares", amount: v.rsu.kept, color: "", pattern: true, lines: [] },
            ]} />
        </div>
      )}
    </section>
  );
}
