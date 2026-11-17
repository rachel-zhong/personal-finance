import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { manualMatch } from "@/lib/refunds/matcher";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as { refundId: string; purchaseId: string; amount?: number };
    const cents = b.amount != null && String(b.amount) !== "" ? Math.round(Number(b.amount) * 100) : undefined;
    return manualMatch(getDb(), b.refundId, b.purchaseId, cents);
  });
}
