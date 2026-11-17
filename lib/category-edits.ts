/** Your category edits: one transaction, or every transaction from the same merchant (same direction). */
import { Db, nowIso } from "./db";
import { isCategory } from "./categories";
import { refreshDerived } from "./store";
import { runAutoMatch } from "./refunds/matcher";
import { rebuildNetWorthSnapshots } from "./networth";

export type Scope = "one" | "merchant";

async function after(db: Db) {
  await refreshDerived(db);
  await runAutoMatch(db);
  await rebuildNetWorthSnapshots(db);
}

/**
 * Set (or with category = null, reset) a transaction's category.
 * scope "merchant" also covers every past and future transaction from that merchant in the same
 * direction (money out vs money in), so Venmo payments and Venmo paybacks stay separate.
 */
export async function setCategory(db: Db, txnId: string, category: string | null, scope: Scope) {
  if (category !== null && !isCategory(category)) throw new Error("Unknown category");
  const t = await db.get<{ merchant_norm: string | null; merchant: string | null; description: string | null; amount: number }>(
    "SELECT merchant_norm, merchant, description, amount FROM transactions WHERE id = ?", [txnId]);
  if (!t) throw new Error("Transaction not found");
  const dir = t.amount < 0 ? "out" : "in";
  let affected = 1;
  await db.tx(async (tx) => {
    if (scope === "merchant") {
      if (!t.merchant_norm) throw new Error("This transaction has no merchant name to match on");
      if (category === null) {
        await tx.run("DELETE FROM category_rules WHERE merchant_norm = ? AND direction = ?", [t.merchant_norm, dir]);
      } else {
        await tx.run(
          `INSERT INTO category_rules (merchant_norm, direction, category, label, created_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (merchant_norm, direction) DO UPDATE SET category = excluded.category`,
          [t.merchant_norm, dir, category, (t.merchant || t.description || t.merchant_norm).slice(0, 80), nowIso()]);
      }
      // A merchant-wide choice replaces one-off edits on that merchant's transactions.
      await tx.run(
        `DELETE FROM category_overrides WHERE txn_id IN (
           SELECT id FROM transactions WHERE merchant_norm = ? AND ${dir === "out" ? "amount < 0" : "amount >= 0"})`,
        [t.merchant_norm]);
      const n = await tx.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM transactions WHERE merchant_norm = ? AND removed = 0 AND ${dir === "out" ? "amount < 0" : "amount >= 0"}`,
        [t.merchant_norm]);
      affected = n?.n ?? 1;
    } else if (category === null) {
      await tx.run("DELETE FROM category_overrides WHERE txn_id = ?", [txnId]);
    } else {
      await tx.run(
        `INSERT INTO category_overrides (txn_id, category, created_at) VALUES (?, ?, ?)
         ON CONFLICT (txn_id) DO UPDATE SET category = excluded.category`,
        [txnId, category, nowIso()]);
    }
  });
  await after(db);
  return { affected };
}

export async function dismissReview(db: Db, key: string) {
  await db.run("INSERT INTO review_dismissals (item_key, created_at) VALUES (?, ?) ON CONFLICT (item_key) DO NOTHING", [key, nowIso()]);
}
