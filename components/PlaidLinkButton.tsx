"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { post } from "./api";
import { Button } from "@/components/ui/button";

const RESUME_KEY = "plaidLinkResume";
interface Resume { token: string; connectionId?: string; addAccounts?: boolean; investments?: boolean; at: number }

/**
 * Opens Plaid Link. With connectionId it runs "update mode" to re-authenticate that bank.
 * Banks that sign you in on their own site (OAuth) send you back to /oauth (PLAID_REDIRECT_URI). That page renders
 * this button with `resume`, which reopens Link with the same token and settings to finish.
 */
export default function PlaidLinkButton({ connectionId: cid, label, addAccounts: add, investments: inv, resume }: {
  connectionId?: string; label?: string; addAccounts?: boolean; investments?: boolean; resume?: boolean;
}) {
  const router = useRouter();
  // On /oauth, the settings come from before the bank's sign-in page (saved below), not from props.
  const [saved] = useState<Resume | null>(() => {
    if (!resume || typeof window === "undefined") return null;
    try {
      const r = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "null") as Resume | null;
      return r && Date.now() - r.at < 30 * 60_000 ? r : null; // Link tokens expire after 30 minutes
    } catch { return null; }
  });
  const connectionId = saved?.connectionId ?? cid;
  const addAccounts = saved?.addAccounts ?? add;
  const investments = saved?.investments ?? inv;
  const [token, setToken] = useState<string | null>(saved?.token ?? null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSuccess = useCallback(async (publicToken: string | null, meta: PlaidLinkOnSuccessMetadata) => {
    try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ }
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
    ...(saved ? { receivedRedirectUri: typeof window !== "undefined" ? window.location.href : undefined } : {}),
    onSuccess,
    onExit: (err) => { try { localStorage.removeItem(RESUME_KEY); } catch { /* ignore */ } setToken(null); setStatus(err ? `Link closed: ${err.display_message || err.error_message}` : investments ? "Closed before finishing. Nothing changed." : null); },
  });

  useEffect(() => { if (token && ready) open(); }, [token, ready, open]);

  async function start() {
    setBusy(true); setStatus(null);
    try {
      const r = await post<{ link_token: string }>("/api/plaid/link-token", connectionId ? { connectionId, addAccounts, investments } : {});
      try { localStorage.setItem(RESUME_KEY, JSON.stringify({ token: r.link_token, connectionId, addAccounts, investments, at: Date.now() } satisfies Resume)); } catch { /* private mode */ }
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
