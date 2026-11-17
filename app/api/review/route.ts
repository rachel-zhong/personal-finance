import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { confirmMatch } from "@/lib/review";
import { dismissReview } from "@/lib/category-edits";

export const runtime = "nodejs";

/** { action: "confirm-match", matchId } | { action: "dismiss", key } */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as { action: string; matchId?: string; key?: string };
    if (b.action === "confirm-match" && b.matchId) { await confirmMatch(getDb(), b.matchId); return { ok: true }; }
    if (b.action === "dismiss" && b.key) { await dismissReview(getDb(), b.key); return { ok: true }; }
    throw new Error("Unknown review action");
  });
}
