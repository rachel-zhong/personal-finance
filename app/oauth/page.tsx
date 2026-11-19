import Link from "next/link";
import PlaidLinkButton from "@/components/PlaidLinkButton";

/**
 * Where a bank's own sign-in page sends you back (PLAID_REDIRECT_URI = https://<your app>/oauth).
 * Plaid Link reopens here to finish connecting or re-connecting.
 */
export default function OAuthReturn() {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <h1 className="text-xl font-semibold">Finishing with your bank…</h1>
      <p className="text-sm text-muted-foreground">Plaid reopens to finish. If nothing happens, go back and try again.</p>
      <PlaidLinkButton resume label="Continue" />
      <Link href="/connect" className="text-sm">Back to Connections &amp; files</Link>
    </section>
  );
}
