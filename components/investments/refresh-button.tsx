"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { post } from "@/components/api";

interface Result { results: { institution: string; refreshed: boolean; error?: string }[] }

/**
 * Asks Plaid to fetch fresh holdings from your brokers now, instead of waiting for its once-a-day pull.
 * Manual only: free on the Plaid Trial plan, billed per call on paid plans.
 */
export default function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    setBusy(true); setMsg(null);
    try {
      const r = await post<Result>("/api/investments/refresh", {});
      const failed = r.results.filter((x) => !x.refreshed || x.error);
      setMsg(failed.length ? `⚠️ ${failed.map((f) => f.institution).join(", ")} couldn't refresh` : "✓ Refreshed from your brokers");
      router.refresh();
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    } finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {msg && <span className="max-w-[40vw] truncate">{msg}</span>}
      <button type="button" onClick={run} disabled={busy}
        title="Get the latest holdings and balances from your brokers, then update every tab (about a minute)"
        className="flex h-11 items-center gap-1.5 rounded-md border border-input bg-card px-3 text-[13px] font-semibold text-ink-2 hover:bg-hairline disabled:opacity-60 md:h-[34px]">
        <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
        {busy ? "Refreshing…" : "Refresh now"}
      </button>
    </div>
  );
}
