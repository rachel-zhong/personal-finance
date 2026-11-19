import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { matchPayback } from "@/lib/category-edits";

export const runtime = "nodejs";

/** { txnId, purchaseId, amount? } — money in counted as income becomes a payback matched to that purchase. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as { txnId: string; purchaseId: string; amount?: number | string };
    if (!b.txnId || !b.purchaseId) throw new Error("txnId and purchaseId required");
    const cents = b.amount != null && String(b.amount) !== "" ? Math.round(Number(b.amount) * 100) : undefined;
    return matchPayback(getDb(), b.txnId, b.purchaseId, cents);
  });
}
