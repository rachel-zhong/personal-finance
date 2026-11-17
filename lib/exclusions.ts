/**
 * GL-1 / GL-5: leave a transaction out of income, spending and savings (the raw transaction is never changed),
 * and optionally keep a transfer in net worth by moving its amount into a manual account (like Treasury).
 */
import { Db, nowIso, today } from "./db";
import { refreshDerived } from "./store";
import { runAutoMatch } from "./refunds/matcher";
import { rebuildNetWorthSnapshots } from "./networth";
import { addManualBalance } from "./connectors/manual";

async function after(db: Db) {
  await refreshDerived(db);
  await runAutoMatch(db);
  await rebuildNetWorthSnapshots(db);
}

async function adjustManual(db: Db, accountId: string, deltaCents: number, note: string) {
  const a = await db.get<{ name: string; type: string; source: string }>("SELECT name, type, source FROM accounts WHERE id = ?", [accountId]);
  if (!a || a.source !== "manual") throw new Error("Pick one of your manual accounts");
  const b = await db.get<{ balance: number }>(
    "SELECT balance FROM balance_snapshots WHERE account_id = ? ORDER BY as_of DESC LIMIT 1", [accountId]);
  await addManualBalance(db, {
    accountName: a.name, type: a.type, asOf: today(), balanceCents: (b?.balance ?? 0) + deltaCents, note,
  });
}

/** Leave this transaction out of income, spending and savings. It stays visible, marked "Excluded". */
export async function excludeTransaction(db: Db, txnId: string) {
  const t = await db.get<{ id: string }>("SELECT id FROM transactions WHERE id = ?", [txnId]);
  if (!t) throw new Error("Transaction not found");
  await db.run(
    `INSERT INTO txn_exclusions (txn_id, kind, created_at) VALUES (?, 'exclude', ?) ON CONFLICT (txn_id) DO NOTHING`,
    [txnId, nowIso()]);
  await after(db);
}

/**
 * GL-5: exclude a transfer and add it to a manual account so net worth stays flat while the money is away.
 * Money out of a bank adds to the manual account; money coming back subtracts from it.
 */
export async function keepInNetWorth(db: Db, txnId: string, manualAccountId: string) {
  const t = await db.get<{ amount: number; merchant: string | null; description: string | null; date: string }>(
    "SELECT amount, merchant, description, date FROM transactions WHERE id = ?", [txnId]);
  if (!t) throw new Error("Transaction not found");
  const existing = await db.get<{ kind: string; manual_account_id: string | null; manual_amount: number | null }>(
    "SELECT kind, manual_account_id, manual_amount FROM txn_exclusions WHERE txn_id = ?", [txnId]);
  if (existing?.kind === "keep_in_net_worth") throw new Error("Already kept in net worth");
  const delta = -t.amount; // out (negative) → manual account grows
  await adjustManual(db, manualAccountId, delta, `${t.amount < 0 ? "Moved here" : "Returned"}: ${t.merchant || t.description || "transfer"} (${t.date})`);
  await db.run(
    `INSERT INTO txn_exclusions (txn_id, kind, manual_account_id, manual_amount, created_at) VALUES (?, 'keep_in_net_worth', ?, ?, ?)
     ON CONFLICT (txn_id) DO UPDATE SET kind = 'keep_in_net_worth', manual_account_id = excluded.manual_account_id,
       manual_amount = excluded.manual_amount`,
    [txnId, manualAccountId, delta, nowIso()]);
  await after(db);
}

/** Count this transaction again. If it was kept in net worth, the manual account change is reversed. */
export async function includeTransaction(db: Db, txnId: string) {
  const x = await db.get<{ kind: string; manual_account_id: string | null; manual_amount: number | null }>(
    "SELECT kind, manual_account_id, manual_amount FROM txn_exclusions WHERE txn_id = ?", [txnId]);
  if (!x) return;
  if (x.kind === "keep_in_net_worth" && x.manual_account_id && x.manual_amount) {
    await adjustManual(db, x.manual_account_id, -x.manual_amount, "Undid: kept in net worth");
  }
  await db.run("DELETE FROM txn_exclusions WHERE txn_id = ?", [txnId]);
  await after(db);
}
