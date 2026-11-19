"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { post } from "@/components/api";
import { ASSET_LABELS, ASSET_TYPES, type AssetType } from "@/lib/holdings";

export interface ManualAccount { id: string; name: string }
export interface ManualHolding {
  id: string; account_id: string; name: string; ticker: string | null; quantity: number | null; value: number; asset_type: AssetType;
}

const field = "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm";
const labelCls = "flex min-w-0 flex-col gap-1 text-xs font-semibold text-ink-2";

/** IN-7: add or edit a holding inside an account you track by hand. */
export default function ManualHoldingForm({ accounts, holding, onDone }: {
  accounts: ManualAccount[]; holding: ManualHolding | null; onDone: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    accountId: holding?.account_id ?? accounts[0]?.id ?? "",
    name: holding?.name ?? "",
    ticker: holding?.ticker ?? "",
    quantity: holding?.quantity != null ? String(holding.quantity) : "",
    value: holding ? String(holding.value / 100) : "",
    assetType: holding?.asset_type ?? ("stocks" as AssetType),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(action?: "delete") {
    setBusy(true); setError(null);
    try {
      await post("/api/investments/holdings", action === "delete" ? { action, id: holding!.id } : {
        id: holding?.id, accountId: f.accountId, name: f.name, ticker: f.ticker,
        quantity: f.quantity.trim() === "" ? null : Number(f.quantity.replace(/,/g, "")),
        value: Number(f.value.replace(/[$,]/g, "")), assetType: f.assetType,
      });
      onDone();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}
      className="mx-5 mb-3.5 flex flex-col gap-3 rounded-lg border border-border bg-field p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{holding ? "Edit holding" : "Add a holding"}</h3>
        <span className="text-xs text-muted-foreground">For accounts you track by hand. The rest of the account&apos;s balance stays as one line.</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelCls}>Name<input required value={f.name} onChange={set("name")} placeholder="e.g. Acme Corp" className={field} /></label>
        <label className={labelCls}>Ticker (optional)<input value={f.ticker} onChange={set("ticker")} placeholder="e.g. ACME" className={field} /></label>
        <label className={labelCls}>Account
          <select value={f.accountId} onChange={set("accountId")} className={field}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className={labelCls}>Shares (optional)<input inputMode="decimal" value={f.quantity} onChange={set("quantity")} placeholder="e.g. 120" className={field} /></label>
        <label className={labelCls}>Value today ($)<input required inputMode="decimal" value={f.value} onChange={set("value")} placeholder="e.g. 12000" className={field} /></label>
        <label className={labelCls}>Type
          <select value={f.assetType} onChange={set("assetType")} className={field}>
            {ASSET_TYPES.map((t) => <option key={t} value={t}>{ASSET_LABELS[t]}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className="h-10 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="h-10 rounded-lg border border-input bg-card px-4 text-sm font-semibold text-ink-2 hover:bg-hairline">Cancel</button>
        {holding && (
          <button type="button" disabled={busy} onClick={() => { if (confirm(`Delete ${holding.name}?`)) save("delete"); }}
            className="ml-auto h-10 rounded-lg px-3 text-sm font-semibold text-destructive hover:bg-hairline">Delete</button>
        )}
      </div>
    </form>
  );
}
