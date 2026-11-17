/** Orchestrates a full sync across every connector, then rebuilds derived data and refund matches. */
import { Db } from "./db";
import { createPlaidClient, PlaidApi } from "./connectors/plaid/client";
import { syncConnection, SyncResult } from "./connectors/plaid";
import { refreshDerived } from "./store";
import { runAutoMatch } from "./refunds/matcher";
import { rebuildNetWorthSnapshots } from "./networth";

export async function syncAll(db: Db, plaid?: PlaidApi): Promise<{ results: SyncResult[]; refundsMatched: number }> {
  const conns = await db.all<{ id: string; provider: string }>(
    "SELECT id, provider FROM connections ORDER BY created_at",
  );
  const results: SyncResult[] = [];
  const plaidConns = conns.filter((c) => c.provider === "plaid");
  if (plaidConns.length) {
    const client = plaid ?? createPlaidClient();
    for (const c of plaidConns) results.push(await syncConnection(db, client, c.id));
  }
  // simplefin connector would slot in here in a later phase.
  await refreshDerived(db);
  const { created } = await runAutoMatch(db);
  await rebuildNetWorthSnapshots(db);
  return { results, refundsMatched: created };
}
