/**
 * Refund matching. Raw transactions are never edited or merged; matches live in
 * refund_matches and net_spending does the arithmetic.
 *
 * Auto rule: each posted, unmatched money-in "refund" (transfers, payroll and interest
 * are already excluded by classifyFlow) is applied to an earlier posted purchase at the
 * same merchant (merchant_key, so "SP EVERLANE CLOTHING" pairs with "Everlane") within 90 days before
 * (or up to 3 days after, since banks sometimes post the refund first) that still has room: a purchase of exactly the refund amount if there is one, otherwise
 * the most recent. Capped at that purchase's remaining amount. A purchase can absorb several partial
 * refunds. Anything left over stays "unmatched" and reduces spending in its own
 * category and month.
 */
import { Db, newId, nowIso } from "../db";

export const MATCH_WINDOW_DAYS = 90;
/** Banks sometimes post a refund before the purchase it reverses; allow a purchase up to this many days later. */
export const MATCH_GRACE_DAYS = 3;

/** Payment apps: the same "merchant" covers many different people, so never auto-match on name. */
export const P2P_MERCHANTS = ["venmo", "zelle", "paypal", "cash app", "square cash", "apple cash"];
const P2P_SQL = `(${P2P_MERCHANTS.map((m) => `'${m}'`).join(", ")})`;
const P2P_LIKE = P2P_MERCHANTS.map((m) => `merchant_norm LIKE '${m}%'`).join(" OR ");

interface TxnRow {
  id: string;
  date: string;
  amount: number;
  merchant_norm: string;
  merchant_key: string;
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function confidenceFor(refund: number, purchaseRemaining: number, purchaseGross: number, days: number) {
  let c = refund === purchaseGross ? 0.95 : refund <= purchaseRemaining ? 0.8 : 0.6;
  if (days > 45) c -= 0.1;
  return Math.round(c * 100) / 100;
}

export async function runAutoMatch(db: Db): Promise<{ created: number }> {
  return db.tx(async (tx) => {
    // Drop matches that no longer make sense (a side was removed or reclassified).
    await tx.run(`
      DELETE FROM refund_matches WHERE id IN (
        SELECT m.id FROM refund_matches m
          JOIN transactions r ON r.id = m.refund_id
          JOIN transactions p ON p.id = m.purchase_id
         WHERE r.removed = 1 OR p.removed = 1 OR r.flow <> 'refund' OR p.flow <> 'spend'
            OR (m.matched_by = 'auto' AND (r.merchant_norm IN ${P2P_SQL} OR ${P2P_LIKE.replace(/merchant_norm/g, "r.merchant_norm")})))`);

    const refunds = await tx.all<TxnRow>(`
      SELECT t.id, t.date, t.amount, t.merchant_norm, t.merchant_key
        FROM transactions t
       WHERE t.flow = 'refund' AND t.removed = 0 AND t.pending = 0
         AND COALESCE(t.merchant_key, '') <> ''
         AND NOT (${P2P_LIKE.replace(/merchant_norm/g, "t.merchant_norm")})
         AND NOT EXISTS (SELECT 1 FROM refund_matches m WHERE m.refund_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM refund_ignores i WHERE i.refund_id = t.id)
       ORDER BY t.date, t.id`);

    // Pass 1 pairs refunds with a purchase of exactly the same amount (most reliable);
    // pass 2 handles the rest. Doing exact pairs first stops a partial refund from using
    // up a purchase that another refund returns in full.
    let created = 0;
    const done = new Set<string>();
    for (const exactOnly of [true, false]) {
      for (const r of refunds) {
        if (done.has(r.id)) continue;
        const purchase = await tx.get<{ id: string; date: string; gross: number; remaining: number }>(
          `SELECT * FROM (
             SELECT p.id, p.date, -p.amount AS gross,
                    -p.amount - COALESCE((SELECT SUM(amount_applied) FROM refund_matches m WHERE m.purchase_id = p.id), 0) AS remaining
               FROM transactions p
              WHERE p.flow = 'spend' AND p.removed = 0 AND p.pending = 0
                AND p.merchant_key = ?
                AND p.date <= ? AND p.date >= ?) x
            WHERE x.remaining > 0 ${exactOnly ? "AND x.remaining = ?" : ""}
            ORDER BY CASE WHEN x.date <= ? THEN 0 ELSE 1 END, x.date DESC, x.id DESC
            LIMIT 1`,
          exactOnly
            ? [r.merchant_key, shiftDate(r.date, MATCH_GRACE_DAYS), shiftDate(r.date, -MATCH_WINDOW_DAYS), r.amount, r.date]
            : [r.merchant_key, shiftDate(r.date, MATCH_GRACE_DAYS), shiftDate(r.date, -MATCH_WINDOW_DAYS), r.date],
        );
        if (!purchase) continue;
        const applied = Math.min(r.amount, purchase.remaining);
        await tx.run(
          `INSERT INTO refund_matches (id, refund_id, purchase_id, amount_applied, matched_by, confidence, created_at)
           VALUES (?, ?, ?, ?, 'auto', ?, ?)`,
          [newId(), r.id, purchase.id, applied,
            confidenceFor(r.amount, purchase.remaining, purchase.gross, daysBetween(purchase.date, r.date)), nowIso()],
        );
        done.add(r.id);
        created++;
      }
    }
    return { created };
  });
}

export function shiftDate(isoDate: string, days: number) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Remove every match on a refund and stop the auto-matcher from re-matching it. */
export async function unmatchRefund(db: Db, refundId: string) {
  await db.tx(async (tx) => {
    await tx.run("DELETE FROM refund_matches WHERE refund_id = ?", [refundId]);
    await tx.run(
      "INSERT INTO refund_ignores (refund_id, created_at) VALUES (?, ?) ON CONFLICT (refund_id) DO NOTHING",
      [refundId, nowIso()],
    );
  });
}

/** Remove a single match (one refund -> one purchase link). */
export async function removeMatch(db: Db, matchId: string) {
  await db.tx(async (tx) => {
    const m = await tx.get<{ refund_id: string }>("SELECT refund_id FROM refund_matches WHERE id = ?", [matchId]);
    if (!m) return;
    await tx.run("DELETE FROM refund_matches WHERE id = ?", [matchId]);
    await tx.run(
      "INSERT INTO refund_ignores (refund_id, created_at) VALUES (?, ?) ON CONFLICT (refund_id) DO NOTHING",
      [m.refund_id, nowIso()],
    );
  });
}

/**
 * Manually apply (part of) a refund to a purchase. Amount defaults to the most that fits:
 * min(refund's unapplied amount, purchase's remaining amount).
 */
export async function manualMatch(db: Db, refundId: string, purchaseId: string, amountCents?: number) {
  return db.tx(async (tx) => {
    const r = await tx.get<{ amount: number; flow: string; applied: number }>(
      `SELECT t.amount, t.flow, COALESCE((SELECT SUM(amount_applied) FROM refund_matches m WHERE m.refund_id = t.id), 0) AS applied
         FROM transactions t WHERE t.id = ? AND t.removed = 0`,
      [refundId],
    );
    const p = await tx.get<{ gross: number; flow: string; refunded: number }>(
      `SELECT -t.amount AS gross, t.flow, COALESCE((SELECT SUM(amount_applied) FROM refund_matches m WHERE m.purchase_id = t.id), 0) AS refunded
         FROM transactions t WHERE t.id = ? AND t.removed = 0`,
      [purchaseId],
    );
    if (!r || r.flow !== "refund") throw new Error("That transaction is not a refund (money in at a merchant).");
    if (!p || p.flow !== "spend") throw new Error("That transaction is not a purchase.");
    const existing = await tx.get<{ amount_applied: number }>(
      "SELECT amount_applied FROM refund_matches WHERE refund_id = ? AND purchase_id = ?",
      [refundId, purchaseId],
    );
    const refundLeft = r.amount - r.applied + (existing?.amount_applied ?? 0);
    const purchaseLeft = p.gross - p.refunded + (existing?.amount_applied ?? 0);
    const max = Math.min(refundLeft, purchaseLeft);
    const amount = amountCents ?? max;
    if (amount <= 0 || amount > max) {
      throw new Error(`Amount must be between $0.01 and $${(max / 100).toFixed(2)}.`);
    }
    await tx.run(
      `INSERT INTO refund_matches (id, refund_id, purchase_id, amount_applied, matched_by, confidence, created_at)
       VALUES (?, ?, ?, ?, 'manual', 1, ?)
       ON CONFLICT (refund_id, purchase_id) DO UPDATE SET amount_applied = excluded.amount_applied,
         matched_by = 'manual', confidence = 1`,
      [newId(), refundId, purchaseId, amount, nowIso()],
    );
    await tx.run("DELETE FROM refund_ignores WHERE refund_id = ?", [refundId]);
    return { amount };
  });
}

/** Purchases a refund could be applied to: same merchant first, then anything matching the search text. */
export async function candidatePurchases(db: Db, refundId: string, search?: string) {
  const r = await db.get<{ date: string; merchant_key: string }>(
    "SELECT date, merchant_key FROM transactions WHERE id = ?",
    [refundId],
  );
  if (!r) return [];
  const like = search ? `%${search.toLowerCase()}%` : null;
  return db.all<{
    id: string; date: string; merchant: string | null; description: string | null;
    gross: number; remaining: number; account_name: string; same_merchant: number;
  }>(
    `SELECT p.id, p.date, p.merchant, p.description, -p.amount AS gross,
            -p.amount - COALESCE((SELECT SUM(amount_applied) FROM refund_matches m WHERE m.purchase_id = p.id AND m.refund_id <> ?), 0) AS remaining,
            COALESCE(a.display_name, a.name) AS account_name,
            CASE WHEN p.merchant_key = ? THEN 1 ELSE 0 END AS same_merchant
       FROM transactions p JOIN accounts a ON a.id = p.account_id
      WHERE p.flow = 'spend' AND p.removed = 0 AND p.date <= ?   -- up to MATCH_GRACE_DAYS after the refund
        AND (${like ? "LOWER(COALESCE(p.merchant, '') || ' ' || COALESCE(p.description, '')) LIKE ?" : "p.merchant_key = ?"})
      ORDER BY same_merchant DESC, p.date DESC
      LIMIT 50`,
    [refundId, r.merchant_key, shiftDate(r.date, MATCH_GRACE_DAYS), like ?? r.merchant_key],
  );
}

/** Refunds with money left to apply that could go against this purchase: same merchant first. */
export async function candidateRefunds(db: Db, purchaseId: string, search?: string) {
  const p = await db.get<{ date: string; merchant_key: string }>(
    "SELECT date, merchant_key FROM transactions WHERE id = ?", [purchaseId]);
  if (!p) return [];
  const like = search ? `%${search.toLowerCase()}%` : null;
  return db.all<{
    id: string; date: string; merchant: string | null; description: string | null;
    amount: number; left: number; account_name: string; same_merchant: number;
  }>(
    `SELECT r.id, r.date, r.merchant, r.description, r.amount,
            r.amount - COALESCE((SELECT SUM(amount_applied) FROM refund_matches m WHERE m.refund_id = r.id), 0) AS left,
            COALESCE(a.display_name, a.name) AS account_name,
            CASE WHEN r.merchant_key = ? THEN 1 ELSE 0 END AS same_merchant
       FROM transactions r JOIN accounts a ON a.id = r.account_id
      WHERE r.flow = 'refund' AND r.removed = 0 AND r.pending = 0 AND r.date >= ?   -- refund may precede by MATCH_GRACE_DAYS
        AND r.amount - COALESCE((SELECT SUM(amount_applied) FROM refund_matches m WHERE m.refund_id = r.id), 0) > 0
        AND (${like ? "LOWER(COALESCE(r.merchant, '') || ' ' || COALESCE(r.description, '')) LIKE ?" : "r.merchant_key = ?"})
      ORDER BY same_merchant DESC, r.date
      LIMIT 50`,
    [p.merchant_key, shiftDate(p.date, -MATCH_GRACE_DAYS), like ?? p.merchant_key],
  );
}
