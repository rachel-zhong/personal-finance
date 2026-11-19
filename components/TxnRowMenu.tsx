"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TxnRow } from "@/lib/queries";
import { CATEGORIES, P2P_TEXT } from "@/lib/categories";
import { post } from "./api";

type MenuTxn = Pick<TxnRow, "id" | "amount" | "flow" | "category" | "excluded" | "exclusion_kind">
  & Partial<Pick<TxnRow, "merchant" | "description" | "overridden" | "ruled">>;
const SPEND_CATS = CATEGORIES.filter((c) => c.kind === "spend");

/**
 * The faint ⋯ on every transaction: leave it out of totals (GL-1), keep a transfer in net worth (GL-5),
 * or mark money in as "money back" (a friend paying you back, a work reimbursement) so it isn't income.
 */
export default function TxnRowMenu({ t, label }: { t: MenuTxn; label: string }) {
  const router = useRouter();
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [accounts, setAccounts] = useState<{ id: string; name: string }[] | null>(null);
  const [target, setTarget] = useState("");
  const isP2P = P2P_TEXT.test(`${t.merchant ?? ""} ${t.description ?? ""}`);
  const [backCat, setBackCat] = useState(isP2P ? "dining" : "other");
  const [allFromSender, setAllFromSender] = useState(false);
  // Money in counted as income can become "money back"; one you marked can go back to income.
  const canMoneyBack = !t.excluded && t.amount > 0 && t.flow === "income";
  const canUndoMoneyBack = !t.excluded && t.amount > 0 && !!(t.overridden || t.ruled)
    && (t.flow === "refund" || (t.flow === "transfer" && t.category === "transfer"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const open = pos !== null;
  const kept = t.exclusion_kind === "keep_in_net_worth";
  // Account-to-account moves can be kept in net worth; card payments and category-less rows can't.
  const canKeep = !t.excluded && t.flow === "transfer" && t.category !== "card_payment";

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!(e instanceof KeyboardEvent) && ref.current?.contains(e.target as Node)) return; setPos(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", close, true); };
  }, [open]);

  async function toggle() {
    if (open) { setPos(null); return; }
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setErr(null);
    if (canKeep && !accounts) {
      const res = await fetch("/api/exclude").then((x) => x.json()).catch(() => null);
      const list = (res?.accounts ?? []) as { id: string; name: string }[];
      setAccounts(list);
      setTarget((cur) => cur || list.find((a) => /treasur/i.test(a.name))?.id || list[0]?.id || "");
    }
  }

  async function run(body: Record<string, unknown>, url = "/api/exclude") {
    setBusy(true); setErr(null);
    try { await post(url, { txnId: t.id, ...body }); setPos(null); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div ref={ref} className="flex justify-end">
      <button ref={btn} type="button" onClick={toggle} aria-label={`More options for ${label}`} aria-expanded={open} aria-haspopup="menu"
        className="size-8 rounded-md text-lg leading-none text-muted-foreground/60 hover:bg-hairline hover:text-foreground">⋯</button>
      {pos && (
        <div role="menu" style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 flex max-h-[70vh] w-[290px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-border bg-card p-1.5 text-left text-sm font-normal text-foreground shadow-lg">
          {t.excluded ? (
            <button type="button" role="menuitem" disabled={busy} onClick={() => run({ action: "include" })}
              className="flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-hairline">
              <span className="font-semibold">Count it again</span>
              <span className="text-xs text-muted-foreground">
                {kept ? "Puts it back in your totals and undoes the change to your manual account." : "Puts it back in income, spending and savings."}
              </span>
            </button>
          ) : (
            <button type="button" role="menuitem" disabled={busy} onClick={() => run({ action: "exclude" })}
              className="flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-hairline">
              <span className="font-semibold">Exclude from totals</span>
              <span className="text-xs text-muted-foreground">Leaves income, spending and savings. Stays in your history.</span>
            </button>
          )}
          {canKeep && (
            <div className="flex flex-col gap-1.5 rounded-md px-2.5 py-2">
              <span className="font-semibold">Keep in net worth</span>
              <span className="text-xs text-muted-foreground">
                {t.amount < 0 ? "Adds this amount to a manual account (like Treasury) so net worth doesn't drop while the money is away."
                  : "Takes this amount off the manual account it came from, so net worth stays flat."}
              </span>
              {accounts && !accounts.length
                ? <span className="text-xs text-muted-foreground">Add a manual account on the Overview first.</span>
                : (
                  <div className="flex gap-1.5">
                    <select aria-label="Manual account" value={target} onChange={(e) => setTarget(e.target.value)}
                      className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-[13px]">
                      {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <button type="button" disabled={busy || !target} onClick={() => run({ action: "keep", manualAccountId: target })}
                      className="h-8 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-50">Apply</button>
                  </div>
                )}
            </div>
          )}
          {canMoneyBack && (
            <div className="flex flex-col gap-1.5 rounded-md px-2.5 py-2">
              <span className="font-semibold">Not income: money back</span>
              <span className="text-xs text-muted-foreground">
                A friend paying you back or a work reimbursement. It lowers spending instead. Then open the row to link it to the purchase.
              </span>
              <div className="flex gap-1.5">
                <select aria-label="Pays back spending in" value={backCat} onChange={(e) => setBackCat(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-[13px]">
                  {SPEND_CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <button type="button" disabled={busy} onClick={() => run({ category: backCat, scope: allFromSender ? "merchant" : "one" }, "/api/category")}
                  className="h-8 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-50">Apply</button>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-ink-2">
                <input type="checkbox" checked={allFromSender} onChange={(e) => setAllFromSender(e.target.checked)} />
                Every payment from this sender
              </label>
            </div>
          )}
          {canMoneyBack && (
            <button type="button" role="menuitem" disabled={busy}
              onClick={() => run({ category: "transfer", scope: allFromSender ? "merchant" : "one" }, "/api/category")}
              className="flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-hairline">
              <span className="font-semibold">Not income: my own money</span>
              <span className="text-xs text-muted-foreground">A cash deposit or a move from another of your accounts. Counts as a transfer.</span>
            </button>
          )}
          {canUndoMoneyBack && (
            <button type="button" role="menuitem" disabled={busy}
              onClick={() => run({ category: null, scope: t.ruled ? "merchant" : "one" }, "/api/category")}
              className="flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-hairline">
              <span className="font-semibold">Count as income again</span>
              <span className="text-xs text-muted-foreground">{t.ruled ? "For every payment from this sender." : "Undoes “money back” for this one."}</span>
            </button>
          )}
          {err && <span className="px-2.5 pb-1 text-xs text-destructive">{err}</span>}
        </div>
      )}
    </div>
  );
}
