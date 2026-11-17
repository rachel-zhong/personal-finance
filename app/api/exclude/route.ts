import { getDb } from "@/lib/db";
import { handle } from "@/lib/api-util";
import { excludeTransaction, includeTransaction, keepInNetWorth } from "@/lib/exclusions";

export const runtime = "nodejs";

/** Manual accounts you can keep a transfer in (GL-5). */
export async function GET() {
  return handle(async () => ({
    accounts: await getDb().all<{ id: string; name: string }>(
      "SELECT id, COALESCE(display_name, name) AS name FROM accounts WHERE source = 'manual' ORDER BY name"),
  }));
}

/** { txnId, action: "exclude" | "include" | "keep", manualAccountId? } */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json()) as { txnId: string; action: "exclude" | "include" | "keep"; manualAccountId?: string };
    if (!b.txnId) throw new Error("txnId required");
    const db = getDb();
    if (b.action === "include") await includeTransaction(db, b.txnId);
    else if (b.action === "keep") {
      if (!b.manualAccountId) throw new Error("Choose a manual account");
      await keepInNetWorth(db, b.txnId, b.manualAccountId);
    } else await excludeTransaction(db, b.txnId);
    return { ok: true };
  });
}
