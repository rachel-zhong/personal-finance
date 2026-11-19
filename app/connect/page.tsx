import { getDb } from "@/lib/db";
import { listConnections } from "@/lib/queries";
import { timeAgo } from "@/lib/format";
import { plaidEnv } from "@/lib/connectors/plaid/client";
import PlaidLinkButton from "@/components/PlaidLinkButton";
import { investmentConnections } from "@/lib/investments";
import PayUpload from "@/components/files/pay-upload";
import LogoutButton from "@/components/logout-button";
import Copyright from "@/components/copyright";
import WebsiteLink from "@/components/files/website-link";
import { getLink } from "@/lib/website-link";
import { authEnabled, isHosted, payUploadsEnabled } from "@/lib/hosted";

export const dynamic = "force-dynamic";

export default async function ConnectPage() {
  const db = getDb();
  const conns = await listConnections(db);
  const inv = new Map((await investmentConnections(db)).map((c) => [c.id, c]));
  const configured = !!process.env.PLAID_CLIENT_ID && !!process.env.PLAID_SECRET;
  const env = plaidEnv();

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[32px] font-semibold">Connections &amp; files</h1>
        <p className="text-sm text-muted-foreground">Banks synced through Plaid (read-only: this app can&apos;t move money), and documents you add yourself.</p>
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

      {payUploadsEnabled() && <section aria-label="Pay documents" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div>
          <h2 className="text-base font-semibold">Pay documents</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Filed into the app&apos;s private pay folder and added to Compensation right away. Never uploaded anywhere or sent to GitHub.
          </p>
        </div>
        <PayUpload />
      </section>}

      {!isHosted() && (
        <section id="website" aria-label="Compensation on the website" className="flex scroll-mt-4 flex-col gap-3 rounded-xl border border-border bg-card p-5">
          <div>
            <h2 className="text-base font-semibold">Compensation on your website</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Shows the Compensation tab on your phone. Only the pay numbers are sent; the PDFs stay on this Mac.
              After the one-time setup, new pay documents update the website automatically.
            </p>
          </div>
          <WebsiteLink link={getLink()} />
        </section>
      )}

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
            {inv.has(c.id) && c.status === "active" && (
              <div className="flex basis-full flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
                {inv.get(c.id)!.investments_enabled
                  ? <span className="rounded-full bg-accent px-2 py-0.5 font-semibold text-accent-foreground">investment details on</span>
                  : <>
                      <PlaidLinkButton connectionId={c.id} label="Add investment details" investments />
                      <span>Holdings, cost basis and dividends for the Investments tab. Uses this same connection.</span>
                    </>}
                {inv.get(c.id)!.investments_error && <span className="basis-full text-destructive">Investments: {inv.get(c.id)!.investments_error}</span>}
              </div>
            )}
          </div>
        ))}
      </section>

      {authEnabled() && (
        <section aria-label="Login" className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Login</h2>
          <p className="text-xs text-muted-foreground">You stay signed in for 30 days on each device. Changing the password on Railway signs every device out.</p>
          <LogoutButton />
        </section>
      )}
      <Copyright className="text-center" />
    </>
  );
}
