import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { createPlaidClient } from "@/lib/connectors/plaid/client";
import { snapshotHoldings, syncInvestments } from "@/lib/investments";

export const runtime = "nodejs";
export const maxDuration = 120;

/** After you allow investment details in Plaid Link (update mode on the SAME connection), turn them on and load them. */
export async function POST(req: Request) {
  return handle(async () => {
    const { connectionId } = (await req.json()) as { connectionId?: string };
    const db = getDb();
    const c = await db.get<{ id: string }>("SELECT id FROM connections WHERE id = ? AND provider = 'plaid'", [connectionId ?? ""]);
    if (!c) throw new Error("Unknown connection");
    await db.run("UPDATE connections SET investments_enabled = 1 WHERE id = ?", [c.id]);
    const r = await syncInvestments(db, createPlaidClient(), c.id);
    await snapshotHoldings(db);
    return { holdings: r.holdings, transactions: r.transactions, error: r.error };
  });
}
