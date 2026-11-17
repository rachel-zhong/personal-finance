"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { dayShort, money } from "@/lib/format";
import type { ReviewItem } from "@/lib/review";
import { post } from "../api";

/** One-click confirmations for things the app isn't sure about. */
export default function ReviewList({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(key: string, url: string, body: unknown) {
    setBusy(key); setErr(null);
    try { await post(url, body); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  }
  if (!items.length) return null;

  return (
    <section aria-label="Needs a look" className="flex flex-col gap-1 rounded-xl border border-brand-line bg-brand-mist p-5">
      <h2 className="text-base font-semibold">Needs a look <span className="font-normal text-muted-foreground">({items.length})</span></h2>
      <p className="mb-1 text-xs text-muted-foreground">I wasn&apos;t sure about these. One click each; you can change them later from the transaction.</p>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {items.map((it) => (
        <div key={it.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-brand-line/60 py-3 text-[13px]">
          {it.kind === "match" && (
            <>
              <span className="min-w-0 flex-[1_1_320px]">
                Is the <b>{money(it.refund)}</b> refund from <b>{it.refundDesc}</b> ({dayShort(it.date)}) for the{" "}
                <b>{money(it.purchase)}</b> purchase on {dayShort(it.purchaseDate)}?
                <span className="text-muted-foreground"> {money(it.applied)} applied</span>
              </span>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy === it.key} onClick={() => act(it.key, "/api/review", { action: "confirm-match", matchId: it.matchId })}>Yes, same item</Button>
                <Button size="sm" variant="outline" className="bg-card" disabled={busy === it.key} onClick={() => act(it.key, "/api/refunds/unmatch", { matchId: it.matchId })}>Not a match</Button>
              </div>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
