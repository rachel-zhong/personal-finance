"use client";
import { useState } from "react";
import { dollars } from "@/lib/format";
import { toggleCls } from "@/components/spending/averages";

export interface AllocRow { key: string; label: string; value: number; pct: number }
type View = "asset" | "tax" | "account";
const VIEWS: { key: View; label: string }[] = [
  { key: "asset", label: "Asset type" },
  { key: "tax", label: "Account type" },
  { key: "account", label: "Account" },
];

/** IN-9 / IN-10: where the money sits, by asset type, tax treatment or account. One hue: it's size, not identity. */
export default function Allocation({ views }: { views: Record<View, AllocRow[]> }) {
  const [view, setView] = useState<View>("asset");
  const rows = views[view];
  const top = Math.max(...rows.map((r) => r.value), 1);
  return (
    <section aria-label="Allocation" className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Allocation</h2>
        <div role="group" aria-label="Group by" className="flex overflow-hidden rounded-md border border-input text-[13px] font-semibold">
          {VIEWS.map((v, i) => (
            <button key={v.key} type="button" aria-pressed={view === v.key} onClick={() => setView(v.key)}
              className={toggleCls(view === v.key, i === 0)}>{v.label}</button>
          ))}
        </div>
      </div>
      {!rows.length && <p className="text-sm text-muted-foreground">No investments yet.</p>}
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-col gap-1.5 px-0 py-1.5">
            <div className="flex justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="flex-none tabular-nums"><span className="font-semibold">{dollars(r.value)}</span>
                <span className="ml-2 inline-block w-12 text-right text-muted-foreground">{r.pct.toFixed(r.pct < 1 ? 1 : 0)}%</span></span>
            </div>
            <div className="h-2 w-full rounded-full bg-hairline">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(0.5, (r.value / top) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
