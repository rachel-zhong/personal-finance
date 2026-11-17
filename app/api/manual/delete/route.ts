import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { deleteManualAccount, deleteManualEntry } from "@/lib/connectors/manual";
import { rebuildNetWorthSnapshots } from "@/lib/networth";

export const runtime = "nodejs";

/** { entryId } deletes one balance entry; { accountId } deletes a whole manual account. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as { entryId?: string; accountId?: string };
    const db = getDb();
    let out: { accountDeleted: boolean };
    if (b.entryId) out = await deleteManualEntry(db, b.entryId);
    else if (b.accountId) { await deleteManualAccount(db, b.accountId); out = { accountDeleted: true }; }
    else throw new Error("Pass entryId or accountId");
    await rebuildNetWorthSnapshots(db);
    return out;
  });
}
