import { getDb } from "@/lib/db";
import { listConnections } from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { plaidEnv } from "@/lib/connectors/plaid/client";
import PlaidLinkButton from "@/components/PlaidLinkButton";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const conns = await listConnections(getDb());
  const configured = !!process.env.PLAID_CLIENT_ID && !!process.env.PLAID_SECRET;
  const env = plaidEnv();

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[32px] font-semibold">Connections</h1>
        <p className="text-sm text-muted-foreground">Banks and cards synced through Plaid. Read-only: this app can&apos;t move money.</p>
      </div>

      {!configured && (
        <div className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          Plaid keys missing. Copy <code>.env.example</code> to <code>.env.local</code>, add your keys, then restart <code>npm run dev</code>.
        </div>
      )}
      {configured && env !== "production" && (
        <div className="rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
          PLAID_ENV is <b>{env}</b>: you&apos;ll see Plaid&apos;s fake test banks, not your real ones.
        </div>
      )}

      <section className="rounded-xl border border-border bg-card p-5">
        <PlaidLinkButton />
      </section>

      <section className="flex flex-col rounded-xl border border-border bg-card px-5 py-4">
        <h2 className="pb-2 text-base font-semibold">Connected</h2>
        {!conns.length && <p className="text-sm text-muted-foreground">Nothing connected yet.</p>}
        {conns.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 border-t border-hairline py-3 text-sm">
            <span className="min-w-0 flex-[1_1_200px] font-medium">{c.institution ?? c.provider}</span>
            <span className="text-muted-foreground">{c.account_count} account{c.account_count === 1 ? "" : "s"}</span>
            <span className="text-muted-foreground">synced {timeAgo(c.last_synced_at)}</span>
            {c.status === "active"
              ? <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-foreground">ok</span>
              : <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn">{c.status.replace("_", " ")}</span>}
            {c.status !== "active"
              ? <PlaidLinkButton connectionId={c.id} label="Re-connect" />
              : c.provider === "plaid" && <PlaidLinkButton connectionId={c.id} label="Add accounts" addAccounts />}
            {c.last_error && <div className="basis-full text-xs text-destructive">{c.last_error}</div>}
          </div>
        ))}
      </section>
    </>
  );
}
