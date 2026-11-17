import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { candidatePurchases, candidateRefunds } from "@/lib/refunds/matcher";

export const runtime = "nodejs";

/** ?refundId= lists purchases for a refund; ?purchaseId= lists refunds for a purchase. Optional &q= search. */
export async function GET(req: Request) {
  return handle(async () => {
    const u = new URL(req.url);
    const q = u.searchParams.get("q") || undefined;
    const refundId = u.searchParams.get("refundId");
    const purchaseId = u.searchParams.get("purchaseId");
    if (refundId) return { candidates: await candidatePurchases(getDb(), refundId, q) };
    if (purchaseId) return { candidates: await candidateRefunds(getDb(), purchaseId, q) };
    throw new Error("refundId or purchaseId required");
  });
}
