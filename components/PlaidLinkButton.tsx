"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { post } from "./api";
import { Button } from "@/components/ui/button";

/** Opens Plaid Link. With connectionId it runs "update mode" to re-authenticate that bank. */
export default function PlaidLinkButton({ connectionId, label, addAccounts, investments }: { connectionId?: string; label?: string; addAccounts?: boolean; investments?: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSuccess = useCallback(async (publicToken: string | null, meta: PlaidLinkOnSuccessMetadata) => {
    if (!publicToken && !connectionId) return;
    if (connectionId && investments) {
      setStatus("Investment details allowed. Loading holdings…");
      const r = await post<{ error?: string; holdings: number }>("/api/investments/enable", { connectionId }).catch((e) => ({ error: (e as Error).message, holdings: 0 }));
      setStatus(r.error ? `⚠️ ${r.error}` : `✓ ${r.holdings} holdings loaded`);
      router.refresh();
      return;
    }
    if (connectionId) {
      setStatus(addAccounts ? "Accounts updated. Syncing…" : "Re-connected. Syncing…");
      await post("/api/sync", {}).catch(() => null);
      setStatus(addAccounts ? "✓ Accounts updated" : "✓ Re-connected");
      router.refresh();
      return;
    }
    setStatus(`Connected ${meta.institution?.name ?? "bank"}. Pulling transactions…`);
    try {
      const r = await post<{ result: { added: number; accounts: number; error?: string } }>("/api/plaid/exchange", {
        public_token: publicToken, institution: meta.institution,
      });
      setStatus(r.result.error
        ? `Connected, but first sync failed: ${r.result.error}`
        : `✓ ${meta.institution?.name}: ${r.result.accounts} accounts, ${r.result.added} transactions so far. Plaid keeps loading older history for a few minutes — hit Sync now later.`);
      router.refresh();
    } catch (e) {
      setStatus(`⚠️ ${(e as Error).message}`);
    } finally {
      setToken(null);
    }
  }, [connectionId, addAccounts, investments, router]);

  const { open, ready } = usePlaidLink({
    token,
    onSuccess,
    onExit: (err) => { setToken(null); setStatus(err ? `Link closed: ${err.display_message || err.error_message}` : investments ? "Closed before finishing. Nothing changed." : null); },
  });

  useEffect(() => { if (token && ready) open(); }, [token, ready, open]);

  async function start() {
    setBusy(true); setStatus(null);
    try {
      const r = await post<{ link_token: string }>("/api/plaid/link-token", connectionId ? { connectionId, addAccounts, investments } : {});
      setToken(r.link_token);
    } catch (e) {
      setStatus(`⚠️ ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2.5">
      <Button variant={connectionId ? "outline" : "default"} onClick={start} disabled={busy} className="h-10 px-4 font-semibold">
        {busy ? "Opening…" : label ?? "+ Connect a bank or card"}
      </Button>
      {status && <span className="text-sm">{status}</span>}
    </span>
  );
}
