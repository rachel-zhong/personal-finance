import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { setCategory } from "@/lib/category-edits";

export const runtime = "nodejs";

/** { txnId, category | null, scope: "one" | "merchant" } — null resets to the bank's category. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as { txnId: string; category: string | null; scope?: "one" | "merchant" };
    if (!b.txnId) throw new Error("txnId required");
    return setCategory(getDb(), b.txnId, b.category ?? null, b.scope === "merchant" ? "merchant" : "one");
  });
}
