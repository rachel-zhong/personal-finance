import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { candidatePurchases, candidateRefunds, type CandidateFilter } from "@/lib/refunds/matcher";

export const runtime = "nodejs";

/**
 * ?refundId= lists purchases for a refund; ?purchaseId= lists refunds for a purchase.
 * Optional: &q= text search, &from= &to= dates (YYYY-MM-DD), &merchant=same|any.
 * Returns the candidates plus the filter actually used (so the picker can show the default dates).
 */
export async function GET(req: Request) {
  return handle(async () => {
    const u = new URL(req.url);
    const m = u.searchParams.get("merchant");
    const f: CandidateFilter = {
      q: u.searchParams.get("q") || undefined,
      from: u.searchParams.get("from") || undefined,
      to: u.searchParams.get("to") || undefined,
      merchant: m === "same" || m === "any" ? m : undefined,
    };
    const refundId = u.searchParams.get("refundId");
    const purchaseId = u.searchParams.get("purchaseId");
    const r = refundId ? await candidatePurchases(getDb(), refundId, f)
      : purchaseId ? await candidateRefunds(getDb(), purchaseId, f) : undefined;
    if (r === undefined) throw new Error("refundId or purchaseId required");
    if (r === null) throw new Error("Transaction not found");
    return r;
  });
}
