"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dollars } from "@/lib/format";
import { post } from "../api";

type Mode = "amount" | "all";

/**
 * Balance cell for a cash account, with a quiet pencil to hold money for others:
 *  - Fixed amount: a set sum you update yourself
 *  - Whole balance: everything in the account, following the balance as interest grows
 * Held money is left out of net worth and counted under "Held for others".
 */
export default function SetAside({ id, name, balance, held, mode, included }: {
  id: string; name: string; balance: number | null; held: number; mode: Mode; included: boolean;
}) {
  const router = useRouter();
  const bal = balance ?? 0;
  const [editing, setEditing] = useState(false);
  const [m, setM] = useState<Mode>(mode);
  const [value, setValue] = useState(held && mode === "amount" ? String(held / 100) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = mode === "all" ? Math.max(bal, 0) : Math.min(held, Math.max(bal, 0));

  function reset() {
    setEditing(false); setErr(null); setM(mode);
    setValue(held && mode === "amount" ? String(held / 100) : "");
  }
  async function save() {
    const v = m === "all" ? 0 : Number(value.replace(/[$,\s]/g, "") || 0);
    if (Number.isNaN(v) || v < 0) { setErr("Enter an amount"); return; }
    setBusy(true); setErr(null);
    try {
      await post(`/api/accounts/${id}`, {
        net_worth_held_mode: m, net_worth_held_for_others: v,
        // Setting money aside on a hidden account brings it back, so its held money shows up in the totals.
        ...(included ? {} : { include_in_net_worth: true }),
      });
      setEditing(false);
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (editing) {
    const opt = (k: Mode, label: string) => (
      <button type="button" aria-pressed={m === k} onClick={() => setM(k)}
        className={cn("h-7 px-2.5 text-xs font-semibold", m === k ? "bg-primary text-primary-foreground" : "bg-card text-ink-2 hover:bg-hairline")}>
        {label}
      </button>
    );
    return (
      <form className="flex flex-col items-end gap-1.5" onSubmit={(e) => { e.preventDefault(); save(); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") reset();
          // Enter saves even when focus is on the mode buttons.
          if (e.key === "Enter") { e.preventDefault(); save(); }
        }}>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">Held for others</span>
          <div role="group" aria-label="How much is held for others" className="flex overflow-hidden rounded-md border border-input">
            {opt("amount", "Fixed amount")}
            <span className="w-px bg-input" />
            {opt("all", "Whole balance")}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {m === "amount" ? (
            <div className="flex h-8 items-center rounded-md border border-input bg-field pl-2 focus-within:border-ring">
              <span className="text-sm text-muted-foreground">$</span>
              <input autoFocus inputMode="decimal" aria-label={`Amount of ${name} held for others`} value={value} placeholder="0"
                onChange={(e) => setValue(e.target.value)} className="h-full w-24 bg-transparent px-1 text-right text-sm outline-none" />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">All {dollars(bal)}, follows the balance</span>
          )}
          <button type="submit" disabled={busy} aria-label="Save" className="flex size-8 items-center justify-center rounded-md text-primary hover:bg-accent">
            <Check className="size-4" />
          </button>
          <button type="button" aria-label="Cancel" onClick={reset}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hairline">
            <X className="size-4" />
          </button>
        </div>
        <span className={cn("text-[11px]", err ? "text-destructive" : "text-muted-foreground")}>
          {err ?? (m === "amount" ? `of ${dollars(bal)} · 0 to clear` : "Interest is included automatically")}
        </span>
      </form>
    );
  }

  return (
    <div className="group/aside flex items-center gap-1.5">
      <div className="flex flex-col items-end">
        {/* Main number is what's yours (matches the bank total above); the real balance moves to the small line. */}
        <span className={cn("sensitive text-right text-[15px] font-semibold", shown > 0 && bal - shown <= 0 && "text-[#8A8A93]")}>
          {dollars(shown > 0 ? bal - shown : balance)}
        </span>
        {shown > 0 && (
          <span className="text-right text-xs text-muted-foreground">
            {mode === "all" || shown >= bal ? `All ${dollars(bal)} held for others` : `of ${dollars(bal)} · ${dollars(shown)} held for others`}
          </span>
        )}
      </div>
      <button type="button" onClick={() => setEditing(true)}
        aria-label={shown > 0 ? `Edit money in ${name} held for others` : `Hold part of ${name} for others`}
        title="Money held for others"
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-hairline hover:text-ink-2 focus-visible:text-ink-2 group-hover/aside:text-muted-foreground">
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}
