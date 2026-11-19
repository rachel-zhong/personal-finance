"use client";
import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { dayShort, displayAmount, money } from "@/lib/format";
import { CATEGORIES, categoryLabel, isPayback, isReimbursement, isReviewable } from "@/lib/categories";
import type { MatchRow, TxnRow } from "@/lib/queries";
import { post } from "./api";
import { Pencil } from "lucide-react";
import TxnRowMenu from "./TxnRowMenu";

export type SortKey = "date" | "merchant" | "category" | "account" | "amount";
export type TxnSort = { key: SortKey; dir: 1 | -1 };

/** Amount sorts by the size shown (money in or out alike). Net view uses net amounts. */
export function sortRows(rows: TxnRow[], key: SortKey, dir: 1 | -1, net: boolean) {
  const shown = (t: TxnRow) => {
    if (!net) return t.amount;
    if (t.flow === "spend") return t.amount + t.refunded;
    return t.amount; // refunds rank by their full size, even when matched (shown as $0)
  };
  const val = (t: TxnRow): string | number => {
    switch (key) {
      case "date": return t.date;
      case "merchant": return (t.merchant || t.description || "").toLowerCase();
      case "category": return categoryLabel(t.category).toLowerCase();
      case "account": return t.account_name.toLowerCase();
      case "amount": return Math.abs(shown(t));
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    const c = x < y ? -1 : x > y ? 1 : 0;
    // ties: newest first, so the list stays stable
    return c !== 0 ? c * dir : a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
}

// Phone: merchant + amount on top, date · category below, ⋯ on the right. Wider: the full table.
const GRID = "grid grid-cols-[minmax(0,1fr)_auto_44px] gap-x-3 gap-y-0.5 md:grid-cols-[90px_minmax(0,1fr)_150px_200px_150px_32px] md:gap-3";

type Tag = { text: string; tone: "returned" | "grey" | "warn" | "open" };


/**
 * Net view: matched refunds are folded into their purchase (net amount, struck-through original,
 * "returned $X"); expanding shows the original rows. Raw view: every row exactly as reported.
 */
export default function TxnTable({ rows, matches, view, balances = {}, owedAccounts = [], sort: sortProp, onSort, notes = {}, bare = false }: {
  rows: TxnRow[]; matches: Record<string, MatchRow[]>; view: "net" | "raw";
  /** Running balance per transaction; pass only when viewing a single account. */
  balances?: Record<string, number>; owedAccounts?: string[];
  /** Controlled sort (e.g. from a sort menu). Without it the table keeps its own. */
  sort?: TxnSort; onSort?: (s: TxnSort) => void;
  /** Small explanatory line under a row's merchant. */
  notes?: Record<string, string>;
  /** Inside another card: no border of its own. */
  bare?: boolean;
}) {
  const owed = new Set(owedAccounts);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const net = view === "net";

  // Matched refunds stay in the list (greyed, original struck through) so the record is complete.
  const [ownSort, setOwnSort] = useState<TxnSort>({ key: "date", dir: -1 });
  const sort = sortProp ?? ownSort;
  const setSort = onSort ?? setOwnSort;
  const visible = sortRows(rows, sort.key, sort.dir, net);
  const header = (key: SortKey, label: string, right = false) => {
    const on = sort.key === key;
    return (
      <button type="button" aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
        onClick={() => setSort(on ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === "date" || key === "amount" ? -1 : 1 })}
        className={cn("flex items-center gap-1 text-left text-xs font-semibold hover:text-foreground",
          right && "justify-end", on ? "text-foreground" : "text-muted-foreground")}>
        {label}
        <span aria-hidden="true" className={cn("text-[10px]", !on && "opacity-0")}>{sort.dir === 1 ? "▲" : "▼"}</span>
      </button>
    );
  };

  return (
    <section aria-label="Transaction list" className={cn("overflow-x-auto bg-card", bare ? "rounded-b-xl" : "rounded-xl border border-border")}>
      <div className="md:min-w-[800px]">
        <div className={cn(GRID, "hidden border-b border-border px-5 py-3 text-xs font-semibold text-muted-foreground md:grid")}>
          {header("date", "Date")}{header("merchant", "Merchant")}{header("category", "Category")}
          {header("account", "Account")}{header("amount", "Amount", true)}<span />
        </div>
        {!visible.length && <p className="px-5 py-6 text-sm text-muted-foreground">No transactions match these filters.</p>}
        {visible.map((t) => {
          const isPurchase = t.flow === "spend";
          const isRefund = t.flow === "refund";
          const returned = net && isPurchase && t.refunded > 0;
          const refundLeft = isRefund ? t.amount - t.applied : 0;
          // Money in counted as income that may be a payback (Venmo, reimbursements): open it to match a purchase
          const reviewable = net && !t.pending && !t.excluded && isReviewable(t);
          const expandable = net && !t.pending && (returned || isRefund || reviewable);
          const isOpen = expandable && open.has(t.id);

          let amountCents = t.amount;
          if (returned) amountCents = t.amount + t.refunded;
          if (net && isRefund && t.applied > 0) amountCents = refundLeft;
          const amt = displayAmount(amountCents, t.flow);

          const tags: Tag[] = [];
          if (t.pending) tags.push({ text: "pending", tone: "warn" });
          if (t.excluded) tags.push({ text: t.exclusion_kind === "keep_in_net_worth" ? "Excluded · kept in net worth" : "Excluded", tone: "grey" });
          if (net) {
            if (returned) tags.push({ text: `returned ${money(t.refunded)}`, tone: "returned" });
            if (isRefund && !t.pending) {
              if (isPayback(t)) {
                // Someone paying you back (Venmo, Zelle) or a work reimbursement: not a store refund awaiting a match
                const kind = isReimbursement(t) ? "reimbursement" : "payback";
                tags.push({ text: t.applied > 0 ? `${kind} · matched` : kind, tone: "grey" });
              } else if (t.applied <= 0) {
                tags.push({ text: "unmatched refund", tone: "open" });
              } else if (refundLeft <= 0) {
                tags.push({ text: "matched to purchase", tone: "grey" });
              } else {
                tags.push({ text: `${money(t.applied)} matched · rest unmatched`, tone: "open" });
              }
            }
            if (t.flow === "transfer" && !t.excluded) tags.push({ text: t.amount > 0 ? "not income" : "not spending", tone: "grey" });
            if (reviewable) tags.push({ text: "payback?", tone: "open" });
          }

          return (
            <div key={t.id} className="border-b border-hairline">
              <div className={cn(GRID, "items-center px-4 py-3 text-sm md:px-5 md:py-3.5", isOpen ? "bg-field" : "bg-card",
                net && isRefund && t.applied > 0 && refundLeft <= 0 && "bg-[#FBFBF9] text-[#A1A1AA] [&_span]:!text-[#A1A1AA]")}>
                <span className="hidden text-muted-foreground md:block">{dayShort(t.date)}</span>
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  {expandable && (
                    <button type="button" onClick={() => toggle(t.id)} aria-expanded={isOpen} aria-label="Show original transactions"
                      className="flex size-7 items-center justify-center rounded-md border border-input bg-card p-0 hover:bg-hairline">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-2)" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                        style={{ transform: isOpen ? "rotate(90deg)" : "none" }}><path d="M9 6l6 6-6 6" /></svg>
                    </button>
                  )}
                  <span className="font-medium">{t.merchant || t.description}</span>
                  {notes[t.id] && <span className="basis-full text-xs text-muted-foreground">{notes[t.id]}</span>}
                  {tags.map((g) => (
                    <span key={g.text} className={cn("rounded-full px-2 py-0.5 text-xs font-semibold",
                      // only "pending" is highlighted; refunds, returns and excluded rows are all grey (GL-4)
                      g.tone === "warn" ? "bg-warn-soft text-warn" : "bg-hairline text-ink-2")}>
                      {g.text}
                    </span>
                  ))}
                </div>
                {t.category === "card_payment" ? (
                  <span className="hidden truncate px-1.5 py-1 text-ink-2 md:block" title="Credit card payments are always transfers between your own accounts">
                    {categoryLabel(t.category)}
                  </span>
                ) : (
                <button type="button" onClick={() => setEditing(editing === t.id ? null : t.id)} aria-expanded={editing === t.id}
                  title="Change category"
                  className="group/cat hidden min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-left text-ink-2 hover:bg-hairline md:flex">
                  <span className="truncate">{categoryLabel(t.category)}</span>
                  {(t.overridden || t.ruled) ? <span className="size-1.5 flex-none rounded-full bg-primary" aria-label="set by you" /> : null}
                  <Pencil className="size-3 flex-none text-muted-foreground/0 group-hover/cat:text-muted-foreground" />
                </button>
                )}
                <span className="hidden truncate text-ink-2 md:block">{t.account_name}</span>
                <div className="flex flex-col items-end gap-0.5">
                  <span className={cn("font-semibold", amt.tone === "in" ? "text-income-ink" : "text-foreground", t.excluded && "text-muted-foreground line-through")}>{amt.text}</span>
                  {returned && <span className="text-xs text-muted-foreground line-through">{money(-t.amount)}</span>}
                  {net && isRefund && t.applied > 0 && (
                    <span className="text-xs text-muted-foreground line-through">+{money(t.amount)}</span>
                  )}
                  {balances[t.id] != null && (
                    <span className="text-[11px] text-muted-foreground/80" title="Account balance right after this transaction (estimated from today's balance)">
                      {owed.has(t.account_id)
                        ? balances[t.id] < 0 ? `card credit ${money(-balances[t.id])}` : `card balance ${money(balances[t.id])}`
                        : `balance ${money(balances[t.id])}`}
                    </span>
                  )}
                </div>
                <div className="row-span-2 self-center md:row-span-1">
                  <TxnRowMenu t={t} label={t.merchant || t.description || "transaction"} />
                </div>
                {/* Phone only: date · category (tap to change) under the merchant */}
                <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground md:hidden">
                  <span>{dayShort(t.date)}</span>
                  <span aria-hidden="true">·</span>
                  {t.category === "card_payment"
                    ? <span>{categoryLabel(t.category)}</span>
                    : (
                      <button type="button" onClick={() => setEditing(editing === t.id ? null : t.id)} aria-expanded={editing === t.id}
                        className="tight -my-1 rounded px-1 py-1 text-left text-xs text-ink-2 underline decoration-dotted underline-offset-2">
                        {categoryLabel(t.category)}
                      </button>
                    )}
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{t.account_name}</span>
                </div>
              </div>
              {editing === t.id && <CategoryEditor t={t} onDone={() => setEditing(null)} />}
              {isOpen && <Originals t={t} links={matches[t.id] ?? []} refundLeft={refundLeft} />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Originals({ t, links, refundLeft }: { t: TxnRow; links: MatchRow[]; refundLeft: number }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const isPurchase = t.flow === "spend";

  // Money in counted as income: match it to a purchase and it becomes a payback (not income).
  if (t.flow === "income") {
    return (
      <div className="mb-3.5 ml-4 mr-4 rounded-lg border border-border bg-field px-3.5 py-1.5 md:ml-[122px] md:mr-5">
        <div className="py-1.5 text-xs font-semibold text-muted-foreground">Counted as income. Paying you back for something?</div>
        <Line date={t.date} desc={`${t.merchant || t.description}`} note="Money in" amount={`+${money(t.amount)}`} />
        <div className="flex gap-4 border-t border-hairline pb-1.5 pt-2.5 text-[13px]">
          <button type="button" className="text-primary hover:underline" onClick={() => setLinking(!linking)}>
            Match {money(t.amount)} to a purchase
          </button>
        </div>
        {linking && <Picker t={t} left={t.amount} payback />}
      </div>
    );
  }

  async function unmatch(matchId: string) {
    setErr(null);
    try { await post("/api/refunds/unmatch", { matchId }); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="mb-3.5 ml-[122px] mr-5 rounded-lg border border-border bg-field px-3.5 py-1.5">
      <div className="py-1.5 text-xs font-semibold text-muted-foreground">Original transactions</div>
      <Line date={t.date} desc={`${t.merchant || t.description} ${isPurchase ? "purchase" : "refund"}`}
        note={isPurchase ? "Purchase" : "Refund"} amount={isPurchase ? money(-t.amount) : `+${money(t.amount)}`} />
      {links.map((m) => (
        <Fragment key={m.id}>
          <Line date={m.other_date}
            desc={`${m.other_desc} ${isPurchase ? "refund" : "purchase"}${m.amount_applied !== Math.abs(m.other_amount) ? ` · ${money(m.amount_applied)} applied` : ""}`}
            note={m.matched_by === "auto" ? `Matched automatically · ${Math.round((m.confidence ?? 0) * 100)}%` : "Matched by you"}
            amount={isPurchase ? `+${money(m.other_amount)}` : money(-m.other_amount)}
            action={<button type="button" className="text-[13px] text-primary hover:underline" onClick={() => unmatch(m.id)}>
              {isPurchase ? "Unmatch refund" : "Unmatch"}
            </button>} />
        </Fragment>
      ))}
      {err && <p className="py-1 text-sm text-destructive">{err}</p>}
      <div className="flex gap-4 border-t border-hairline pb-1.5 pt-2.5 text-[13px]">
        {isPurchase && <button type="button" className="text-primary hover:underline" onClick={() => setLinking(!linking)}>Link another refund</button>}
        {!isPurchase && refundLeft > 0 && (
          <button type="button" className="text-primary hover:underline" onClick={() => setLinking(!linking)}>
            Match {money(refundLeft)} to a purchase
          </button>
        )}
      </div>
      {linking && <Picker t={t} left={isPurchase ? -t.amount - t.refunded : refundLeft} />}
    </div>
  );
}

function Line({ date, desc, note, amount, action }: { date: string; desc: string; note: string; amount: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline py-2 text-[13px]">
      <span className="flex-[0_0_70px] text-muted-foreground">{dayShort(date)}</span>
      <span className="min-w-0 flex-[1_1_200px]">{desc}</span>
      <span className="flex-none text-muted-foreground">{note}</span>
      <span className="flex-[0_0_90px] text-right font-semibold">{amount}</span>
      {action && <span className="flex-none">{action}</span>}
    </div>
  );
}

interface Cand {
  id: string; date: string; merchant: string | null; description: string | null;
  account_name: string; same_merchant: number; gross?: number; remaining?: number; amount?: number; left?: number;
}

interface Filter { q: string; from: string; to: string; merchant: "same" | "any" }

/**
 * Pick the other side of a match. From a purchase: refunds with money left. From a refund (or payback): purchases.
 * Filters: same or any merchant, a date range (defaults come back from the server), and a text search.
 */
function Picker({ t, left, payback = false }: { t: TxnRow; left: number; payback?: boolean }) {
  const router = useRouter();
  const isPurchase = t.flow === "spend";
  const [f, setF] = useState<Filter | null>(null);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load(next: Partial<Filter> = {}) {
    setErr(null); setBusy(true);
    const want = { ...(f ?? {}), ...next };
    const qs = new URLSearchParams({ [isPurchase ? "purchaseId" : "refundId"]: t.id });
    for (const k of ["q", "from", "to", "merchant"] as const) if (want[k]) qs.set(k, want[k] as string);
    try {
      const r = await fetch(`/api/refunds/candidates?${qs}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setCands(j.candidates);
      setF({ q: want.q ?? "", from: j.from, to: j.to, merchant: j.merchant });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function match(other: Cand) {
    setErr(null);
    try {
      if (payback) await post("/api/refunds/payback", { txnId: t.id, purchaseId: other.id, amount: amounts[other.id] || undefined });
      else await post("/api/refunds/match", {
        refundId: isPurchase ? other.id : t.id,
        purchaseId: isPurchase ? t.id : other.id,
        amount: amounts[other.id] || undefined,
      });
      router.refresh();
    } catch (e) { setErr((e as Error).message); }
  }

  const what = isPurchase ? "refunds" : "purchases";
  if (!f) {
    return (
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => load()}>
          {payback ? "Show purchases around this date" : `Find ${what} to match`}
        </Button>
        {err && <span className="text-sm text-destructive">{err}</span>}
      </div>
    );
  }
  const seg = (on: boolean, first: boolean) => cn("h-8 px-2.5 text-xs font-semibold", !first && "border-l border-input",
    on ? "bg-primary text-primary-foreground" : "bg-card text-ink-2 hover:bg-hairline");
  return (
    <div className="pb-2">
      {/* Filters: which merchants, which dates, optional text. Each change reloads the list. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-field px-3 py-2 text-xs">
        <div role="group" aria-label="Merchant" className="flex overflow-hidden rounded-md border border-input">
          <button type="button" aria-pressed={f.merchant === "same"} className={seg(f.merchant === "same", true)} onClick={() => load({ merchant: "same" })}>Same merchant</button>
          <button type="button" aria-pressed={f.merchant === "any"} className={seg(f.merchant === "any", false)} onClick={() => load({ merchant: "any" })}>Any merchant</button>
        </div>
        <label className="flex items-center gap-1.5 text-muted-foreground">From
          <input type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && load({ from: e.target.value })}
            className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground" />
        </label>
        <label className="flex items-center gap-1.5 text-muted-foreground">To
          <input type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && load({ to: e.target.value })}
            className="h-8 rounded-md border border-input bg-card px-2 text-xs text-foreground" />
        </label>
        <Input className="h-8 w-44 bg-card text-xs" placeholder="Search name…" value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); load({ q: f.q }); } }} />
        <span className="text-muted-foreground">
          {busy ? "Loading…" : `${cands?.length ?? 0} ${what}${cands?.length === 100 ? " (first 100)" : ""} · closest to ${dayShort(t.date)} first`}
        </span>
      </div>
      {err && <p className="pt-2 text-sm text-destructive">{err}</p>}
      {cands && !cands.length && !busy && (
        <p className="py-2 text-xs text-muted-foreground">
          Nothing in these dates{f.merchant === "same" ? " at this merchant. Try Any merchant" : ". Try wider dates"}{f.q ? " or clear the search" : ""}.
        </p>
      )}
      {cands?.map((c) => {
        const room = isPurchase ? (c.left ?? 0) : (c.remaining ?? 0);
        const fits = Math.min(left, room);
        return (
          <div key={c.id} className="flex flex-wrap items-center gap-2 border-t border-hairline py-2 text-[13px]">
            <span className="w-[70px] text-muted-foreground">{dayShort(c.date)}</span>
            <span className="min-w-0 flex-1">{c.merchant || c.description}
              {c.same_merchant ? <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">same merchant</span> : null}
              <span className="ml-2 text-muted-foreground">{c.account_name}</span>
            </span>
            <span className="text-muted-foreground">{money(room)} {isPurchase ? "left on refund" : "left on purchase"}</span>
            <Input className="h-8 w-24 bg-card" inputMode="decimal" placeholder={(fits / 100).toFixed(2)}
              value={amounts[c.id] ?? ""} onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })} />
            <Button size="sm" disabled={fits <= 0} onClick={() => match(c)}>Match</Button>
          </div>
        );
      })}
    </div>
  );
}

/** Change a transaction's category: just this one, or every one from the same merchant. */
function CategoryEditor({ t, onDone }: { t: TxnRow; onDone: () => void }) {
  const router = useRouter();
  const [cat, setCat] = useState(t.category ?? "other");
  const many = t.merchant_count > 1;
  const [scope, setScope] = useState<"one" | "merchant">(t.ruled ? "merchant" : "one");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const name = t.merchant || t.description || "this merchant";
  const dirWord = t.amount < 0 ? "payments to" : "money from";

  async function save(category: string | null, sc = scope) {
    setBusy(true); setMsg(null);
    try {
      await post("/api/category", { txnId: t.id, category, scope: sc });
      router.refresh();
      onDone();
    } catch (e) { setMsg((e as Error).message); setBusy(false); }
  }

  const spend = CATEGORIES.filter((c) => c.kind === "spend");
  const other = CATEGORIES.filter((c) => c.kind !== "spend");
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(cat); }} onKeyDown={(e) => e.key === "Escape" && onDone()}
      className="mb-3.5 ml-[122px] mr-5 flex flex-col gap-2.5 rounded-lg border border-border bg-field px-3.5 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Category</span>
        <select autoFocus aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}
          className="h-8 rounded-md border border-input bg-card px-2 text-[13px]">
          <optgroup label="Spending">{spend.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
          <optgroup label="Not spending">{other.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
        </select>
        {t.amount > 0 && CATEGORIES.find((c) => c.key === cat)?.kind === "spend" && (
          <span className="text-muted-foreground">Money back in a spending category lowers that category&apos;s spending.</span>
        )}
      </div>
      {many && (
        <div role="radiogroup" aria-label="Apply to" className="flex flex-wrap gap-4">
          <label className="flex items-center gap-1.5">
            <input type="radio" name={`scope-${t.id}`} checked={scope === "one"} onChange={() => setScope("one")} />
            Just this transaction
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name={`scope-${t.id}`} checked={scope === "merchant"} onChange={() => setScope("merchant")} />
            All {t.merchant_count} {dirWord} <b>{name}</b>, including future ones
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        {(t.overridden || t.ruled) ? (
          <button type="button" className="ml-auto text-muted-foreground hover:underline" disabled={busy}
            onClick={() => save(null, t.ruled && !t.overridden ? "merchant" : "one")}>
            Reset to bank&apos;s category
          </button>
        ) : null}
        {msg && <span className="text-destructive">{msg}</span>}
      </div>
    </form>
  );
}
