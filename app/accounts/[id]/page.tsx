import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { accountLabel, listAccounts, runningBalances, LIABILITY_TYPES } from "@/lib/queries";
import { groupFor } from "@/lib/groups";
import { dayShort, money, monthLong, syncedLabel, shortDate } from "@/lib/format";
import { categoryLabel } from "@/lib/categories";
import { cn } from "@/lib/utils";
import AccountSettings from "@/components/account/account-settings";
import ManualBalance, { Entry } from "@/components/account/manual-balance";
import TxnRowMenu from "@/components/TxnRowMenu";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ f?: string }>;
}) {
  const { id } = await params;
  const f = (await searchParams).f === "in" ? "in" : (await searchParams).f === "out" ? "out" : "all";
  const db = getDb();
  const a = (await listAccounts(db)).find((x) => x.id === id);
  if (!a) notFound();
  const liability = LIABILITY_TYPES.has(a.type);
  const manual = a.source === "manual";
  const month = new Date().toLocaleDateString("en-CA").slice(0, 7);

  const stats = (await db.get<{ inSum: number; inN: number; outSum: number; outN: number }>(
    `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS inSum, COUNT(CASE WHEN amount > 0 THEN 1 END) AS inN,
            COALESCE(SUM(CASE WHEN amount < 0 THEN amount END), 0) AS outSum, COUNT(CASE WHEN amount < 0 THEN 1 END) AS outN
       FROM transactions WHERE account_id = ? AND removed = 0 AND substr(date, 1, 7) = ?`, [id, month]))!;
  const rows = await db.all<{
    id: string; date: string; amount: number; merchant: string | null; description: string | null; category: string | null;
    flow: string; pending: number; excluded: number; exclusion_kind: string | null;
  }>(
    `SELECT t.id, t.date, t.amount, t.merchant, t.description, t.app_category AS category, t.flow, t.pending,
            CASE WHEN ex.txn_id IS NULL THEN 0 ELSE 1 END AS excluded, ex.kind AS exclusion_kind
       FROM transactions t LEFT JOIN txn_exclusions ex ON ex.txn_id = t.id
      WHERE t.account_id = ? AND t.removed = 0 ${f === "in" ? "AND t.amount > 0" : f === "out" ? "AND t.amount < 0" : ""}
      ORDER BY t.date DESC, t.id LIMIT 2000`, [id]);
  const balances = await runningBalances(db, [id]);
  const entries = manual
    ? await db.all<Entry>("SELECT id, as_of, balance, note, created_at FROM manual_entries WHERE account_id = ? ORDER BY as_of DESC, created_at DESC", [id])
    : [];

  const balance = a.balance == null ? null : liability ? -a.balance : a.balance;
  const status = [
    manual ? "Manual" : a.source === "plaid" ? `${a.institution ?? "Plaid"} · synced ${syncedLabel(a.last_synced_at)}` : "CSV import",
    a.net_worth_held_mode === "all" ? "All held for others"
      : a.net_worth_held_for_others > 0 ? `${money(Math.min(a.net_worth_held_for_others, Math.max(a.balance ?? 0, 0)))} held for others`
      : null,
  ].filter(Boolean).join(" · ");
  const mName = monthLong(month);
  const pill = (key: string, label: string) => (
    <Link href={key === "all" ? `/accounts/${id}` : `/accounts/${id}?f=${key}`} aria-pressed={f === key}
      className={cn("flex min-h-9 items-center rounded-full border px-3.5 text-[13px] font-semibold no-underline",
        f === key ? "border-primary bg-primary text-primary-foreground hover:text-primary-foreground" : "border-input bg-card text-ink-2 hover:text-ink-2 hover:bg-hairline")}>
      {label}
    </Link>
  );

  return (
    <>
      <Link href="/" className="tight w-fit text-sm font-medium no-underline">← Back to overview</Link>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[32px] font-semibold">{accountLabel(a)}</h1>
          <span className="text-[13px] text-muted-foreground">{status}</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[13px] text-muted-foreground">{liability ? "Current balance owed" : "Current balance"}</span>
          <span className="font-heading text-4xl font-semibold">{money(balance)}</span>
          {a.balance_as_of && <span className="text-xs text-muted-foreground">as of {shortDate(a.balance_as_of)}</span>}
        </div>
      </div>

      {!manual && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-5">
            <span className="text-[13px] text-muted-foreground">Money in, {mName}</span>
            <span className="font-heading text-[26px] font-semibold text-income-ink">+{money(stats.inSum)}</span>
            <span className="text-xs text-muted-foreground">{stats.inN} transaction{stats.inN === 1 ? "" : "s"}</span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-5">
            <span className="text-[13px] text-muted-foreground">Money out, {mName}</span>
            <span className="font-heading text-[26px] font-semibold">{money(stats.outSum)}</span>
            <span className="text-xs text-muted-foreground">{stats.outN} transaction{stats.outN === 1 ? "" : "s"}</span>
          </div>
          <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-5">
            <span className="text-[13px] text-muted-foreground">Net change, {mName}</span>
            <span className="font-heading text-[26px] font-semibold">{money(stats.inSum + stats.outSum, { sign: true })}</span>
            <span className="text-xs text-muted-foreground">In minus out</span>
          </div>
        </div>
      )}

      {manual && (
        <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">Balance history</h2>
          <ManualBalance accountId={id} accountName={a.name} type={a.type} liability={liability} entries={entries} />
        </section>
      )}

      {!manual && (
        <section aria-label="Account transactions" className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold">Transactions</h2>
            <div role="group" aria-label="Show" className="flex gap-1.5">
              {pill("all", "All")}{pill("in", "Money in")}{pill("out", "Money out")}
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="md:min-w-[680px]">
              {rows.map((r) => {
                const isIn = r.amount > 0;
                const cat = categoryLabel(r.category) + (r.flow === "transfer" && !r.excluded ? (isIn ? " · not income" : " · not spending") : "");
                return (
                  <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto_44px] items-center gap-x-3 gap-y-0.5 border-b border-hairline px-4 py-3 text-sm md:grid-cols-[80px_minmax(0,1fr)_170px_140px_32px] md:gap-3 md:px-5 md:py-3.5">
                    <span className="hidden text-muted-foreground md:block">{dayShort(r.date)}</span>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span aria-hidden="true" className={cn("flex size-7 flex-none items-center justify-center rounded-full text-[15px] font-bold",
                        isIn ? "bg-accent text-accent-foreground" : "bg-hairline text-ink-2")}>{isIn ? "↓" : "↑"}</span>
                      <span className="truncate font-medium">{r.merchant || r.description}</span>
                      {r.pending ? <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">pending</span> : null}
                      {r.excluded ? (
                        <span className="rounded-full bg-hairline px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                          {r.exclusion_kind === "keep_in_net_worth" ? "Excluded · kept in net worth" : "Excluded"}
                        </span>
                      ) : null}
                    </div>
                    <span className="hidden truncate text-muted-foreground md:block">{cat}</span>
                    <span className="flex flex-col items-end">
                      <span className={cn("font-semibold", isIn && "text-income-ink", r.excluded && "text-muted-foreground line-through")}>
                        {isIn ? `+${money(r.amount)}` : money(r.amount)}
                      </span>
                      {balances.has(r.id) && (
                        <span className="text-[11px] text-muted-foreground/80">
                          {liability
                            ? balances.get(r.id)! < 0 ? `card credit ${money(-balances.get(r.id)!)}` : `card balance ${money(balances.get(r.id)!)}`
                            : `balance ${money(balances.get(r.id)!)}`}
                        </span>
                      )}
                    </span>
                    <div className="row-span-2 self-center md:row-span-1">
                      <TxnRowMenu t={r} label={r.merchant || r.description || "transaction"} />
                    </div>
                    <span className="col-span-2 truncate pl-[38px] text-xs text-muted-foreground md:hidden">{dayShort(r.date)} · {cat}</span>
                  </div>
                );
              })}
              {!rows.length && <p className="px-5 py-6 text-sm text-muted-foreground">No transactions.</p>}
            </div>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold">Account settings</h2>
        <AccountSettings a={{
          id, name: a.name, display_name: a.display_name, group: groupFor(a), heldMode: a.net_worth_held_mode,
          include_in_net_worth: !!a.include_in_net_worth, include_in_spending: !!a.include_in_spending,
          held: a.net_worth_held_for_others, note: a.net_worth_note,
        }} />
      </section>
    </>
  );
}
