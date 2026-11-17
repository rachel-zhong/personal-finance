import Link from "next/link";
import { getDb, today } from "@/lib/db";
import { accountLabel, listAccounts, listTransactions, matchesFor, runningBalances, txnSubtotals, txnTypeCounts, LIABILITY_TYPES } from "@/lib/queries";
import SubtotalBar from "@/components/transactions/subtotal-bar";
import { shiftDate } from "@/lib/refunds/matcher";
import TxnTable from "@/components/TxnTable";
import Filters, { FilterState, TypeKey } from "@/components/transactions/filters";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | undefined>>;

function dateRange(range: string, from?: string, to?: string) {
  const t = today();
  switch (range) {
    case "month": return { from: t.slice(0, 8) + "01", to: undefined };
    case "year": return { from: t.slice(0, 5) + "01-01", to: undefined };
    case "all": return { from: undefined, to: undefined };
    case "custom": return { from: from || undefined, to: to || undefined };
    default: return { from: shiftDate(t, -60), to: undefined };
  }
}

export default async function TransactionsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const db = getDb();
  const accounts = await listAccounts(db);
  const range = sp.range ?? (sp.from || sp.to ? "custom" : "60d");
  const view = sp.view === "raw" ? "raw" : "net";
  const { from, to } = dateRange(range, sp.from, sp.to);
  const num = (v?: string) => (v ? Number(v.replace(/[$,\s]/g, "")) : undefined);
  const type: TypeKey = (["in", "out", "refunds", "unmatched"] as const).find((t) => t === sp.type) ?? "";
  const narrow = { account: sp.account || undefined, from, to, min: num(sp.min), max: num(sp.max), q: sp.q || undefined };
  const filters = {
    ...narrow,
    dir: type === "in" || type === "out" ? type : undefined,
    type: type === "refunds" || type === "unmatched" ? type : undefined,
  };
  const counts = await txnTypeCounts(db, narrow);
  const { rows, truncated } = await listTransactions(db, filters);
  const totals = await txnSubtotals(db, filters, view);
  const matches = Object.fromEntries(await matchesFor(db, rows.map((r) => r.id)));
  // The balance line only makes sense when looking at a single account.
  const balances = sp.account ? Object.fromEntries(await runningBalances(db, [sp.account])) : {};
  // An account with no transactions at all (investment and manual accounts): say why, and where the money shows instead.
  const picked = sp.account ? accounts.find((a) => a.id === sp.account) : undefined;
  const pickedEmpty = picked
    ? !(await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND removed = 0", [picked.id]))?.n
    : false;
  const searchName = picked ? (picked.source === "manual" ? picked.name : picked.institution ?? picked.name).split(/\s+/)[0] : "";
  const owedAccounts = accounts.filter((a) => LIABILITY_TYPES.has(a.type)).map((a) => a.id);

  const initial: FilterState = {
    q: sp.q ?? "", account: sp.account ?? "", range, from: sp.from ?? "", to: sp.to ?? "",
    min: sp.min ?? "", max: sp.max ?? "", view, type,
  };

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[32px] font-semibold">Transactions</h1>
      </div>
      <Filters key={JSON.stringify(initial)} initial={initial} counts={counts}
        accounts={accounts.map((a) => ({ id: a.id, label: `${a.institution ? a.institution + " · " : ""}${accountLabel(a)}` }))} />
      <SubtotalBar type={type} totals={totals} truncated={truncated}
        viewNote={view === "raw" ? "Raw: every transaction exactly as your bank reported it" : "Net: refunds are netted against their purchase"} />
      {picked && pickedEmpty && (
        <p className="rounded-xl border border-border bg-card px-5 py-4 text-sm text-ink-2">
          {picked.source === "manual"
            ? <>{accountLabel(picked)} is a manual account: it has dated balances, not transactions. </>
            : <>{picked.institution ?? "This provider"} only shares balances for {accountLabel(picked)}, not its trades (that needs Plaid&apos;s paid Investments product). </>}
          Money you moved in or out shows on your bank accounts:{" "}
          <Link href={`/transactions?q=${encodeURIComponent(searchName.toLowerCase())}&range=all`}>see transfers matching &ldquo;{searchName}&rdquo;</Link>
          {picked.source === "manual" && <> · <Link href={`/accounts/${picked.id}`}>balance history</Link></>}
        </p>
      )}
      <TxnTable rows={rows} matches={matches} view={view} balances={balances} owedAccounts={owedAccounts} />
    </>
  );
}
