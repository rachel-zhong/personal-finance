import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { createPlaidClient } from "@/lib/connectors/plaid/client";
import { linkNewItem, syncConnection } from "@/lib/connectors/plaid";
import { refreshDerived } from "@/lib/store";
import { runAutoMatch } from "@/lib/refunds/matcher";
import { rebuildNetWorthSnapshots } from "@/lib/networth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const { public_token, institution } = (await req.json()) as {
      public_token: string; institution?: { institution_id?: string; name?: string } | null;
    };
    if (!public_token) throw new Error("Missing public_token");
    const db = getDb();
    const plaid = createPlaidClient();
    const connectionId = await linkNewItem(db, plaid, public_token, {
      id: institution?.institution_id, name: institution?.name,
    });
    // First pull. Plaid may still be fetching history; a later sync picks up the rest.
    const result = await syncConnection(db, plaid, connectionId);
    await refreshDerived(db);
    await runAutoMatch(db);
    await rebuildNetWorthSnapshots(db);
    return { connectionId, result };
  });
}
