"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { dollars } from "@/lib/format";
import { post } from "../api";

/**
 * Balance cell for a manual account: click the pencil, type the new balance, Enter.
 * Saves a new balance entry dated today (history stays on the account page).
 */
export default function ManualBalanceCell({ name, type, balance, liability }: {
  name: string; type: string; balance: number | null; liability: boolean;
}) {
  const router = useRouter();
  const owed = liability && balance != null ? -balance : balance; // stored positive for cards/loans
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function start() { setValue(owed != null ? String(owed / 100) : ""); setErr(null); setEditing(true); }
  async function save() {
    const v = Number(value.replace(/[$,\s]/g, ""));
    if (!value.trim() || Number.isNaN(v)) { setErr("Enter a balance"); return; }
    setBusy(true); setErr(null);
    try {
      await post("/api/manual", { accountName: name, type, balance: v });
      setEditing(false);
      router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <form className="flex flex-col items-end gap-1" onSubmit={(e) => { e.preventDefault(); save(); }}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}>
        <div className="flex items-center gap-1">
          <div className="flex h-8 items-center rounded-md border border-input bg-field pl-2 focus-within:border-ring">
            <span className="text-sm text-muted-foreground">$</span>
            <input autoFocus inputMode="decimal" aria-label={`New balance for ${name}`} value={value}
              onFocus={(e) => e.target.select()} onChange={(e) => setValue(e.target.value)}
              className="h-full w-28 bg-transparent px-1 text-right text-sm outline-none" />
          </div>
          <button type="submit" disabled={busy} aria-label="Save" className="flex size-8 items-center justify-center rounded-md text-primary hover:bg-accent">
            <Check className="size-4" />
          </button>
          <button type="button" aria-label="Cancel" onClick={() => setEditing(false)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hairline">
            <X className="size-4" />
          </button>
        </div>
        <span className={cn("text-[11px]", err ? "text-destructive" : "text-muted-foreground")}>
          {err ?? `New balance${liability ? " owed" : ""} as of today`}
        </span>
      </form>
    );
  }

  return (
    <div className="group/manual flex items-center gap-1.5">
      <span className="text-right text-[15px] font-semibold">{dollars(balance)}</span>
      <button type="button" onClick={start} aria-label={`Update balance for ${name}`} title="Update balance"
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-hairline hover:text-ink-2 focus-visible:text-ink-2 group-hover/manual:text-muted-foreground">
        <Pencil className="size-3.5" />
      </button>
    </div>
  );
}
