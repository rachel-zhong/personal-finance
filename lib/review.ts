/**
 * "Needs a look": things the app isn't sure about, for you to confirm with one click.
 *  - refund matches made with low confidence
 */
import { Db } from "./db";

export type ReviewItem =
  | { kind: "match"; key: string; matchId: string; date: string; refund: number; refundDesc: string;
      purchase: number; purchaseDesc: string; purchaseDate: string; applied: number; confidence: number }
  | { kind: "payback"; key: string; txnId: string; date: string; amount: number; desc: string };


export async function reviewItems(db: Db, month: string): Promise<ReviewItem[]> {
  const dismissed = new Set((await db.all<{ item_key: string }>("SELECT item_key FROM review_dismissals")).map((r) => r.item_key));
  const items: ReviewItem[] = [];

  // 1. Low-confidence automatic refund matches (refund received this month)
  const matches = await db.all<{
    id: string; confidence: number; amount_applied: number; rdate: string; ramount: number; rdesc: string;
    pdate: string; pamount: number; pdesc: string;
  }>(
    `SELECT m.id, m.confidence, m.amount_applied, r.date AS rdate, r.amount AS ramount, COALESCE(r.merchant, r.description) AS rdesc,
            p.date AS pdate, p.amount AS pamount, COALESCE(p.merchant, p.description) AS pdesc
       FROM refund_matches m JOIN transactions r ON r.id = m.refund_id JOIN transactions p ON p.id = m.purchase_id
      WHERE m.matched_by = 'auto' AND COALESCE(m.confidence, 0) < 0.8 AND substr(r.date, 1, 7) = ?
      ORDER BY r.date`, [month]);
  for (const m of matches) {
    items.push({ kind: "match", key: `match:${m.id}`, matchId: m.id, date: m.rdate, refund: m.ramount, refundDesc: m.rdesc,
      purchase: -m.pamount, purchaseDesc: m.pdesc, purchaseDate: m.pdate, applied: m.amount_applied, confidence: m.confidence });
  }

  return items;
}

export async function confirmMatch(db: Db, matchId: string) {
  await db.run("UPDATE refund_matches SET matched_by = 'manual', confidence = 1 WHERE id = ?", [matchId]);
}
