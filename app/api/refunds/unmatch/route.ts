import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { removeMatch, unmatchRefund } from "@/lib/refunds/matcher";

export const runtime = "nodejs";

/** { matchId } removes one link; { refundId } clears every link on that refund. Either way auto-match won't redo it. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as { matchId?: string; refundId?: string };
    if (b.matchId) await removeMatch(getDb(), b.matchId);
    else if (b.refundId) await unmatchRefund(getDb(), b.refundId);
    else throw new Error("Pass matchId or refundId");
    return { ok: true };
  });
}
