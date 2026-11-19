import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { ASSET_TYPES, AssetType, deleteManualHolding, saveManualHolding } from "@/lib/investments";

export const runtime = "nodejs";

/** Add, edit or delete a holding you track by hand (IN-7). Value is in dollars. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as {
      action?: "delete"; id?: string; accountId?: string; name?: string; ticker?: string; quantity?: number | null; value?: number; assetType?: string;
    };
    const db = getDb();
    if (b.action === "delete") {
      if (!b.id) throw new Error("Missing id");
      await deleteManualHolding(db, b.id);
      return { ok: true };
    }
    if (!ASSET_TYPES.includes(b.assetType as AssetType)) throw new Error("Pick a type");
    const id = await saveManualHolding(db, {
      id: b.id, accountId: b.accountId ?? "", name: b.name ?? "", ticker: b.ticker,
      quantity: b.quantity == null || Number.isNaN(b.quantity) ? null : Number(b.quantity),
      valueCents: Math.round(Number(b.value) * 100), assetType: b.assetType as AssetType,
    });
    return { id };
  });
}
